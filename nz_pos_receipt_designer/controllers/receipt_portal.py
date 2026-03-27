# -*- coding: utf-8 -*-
import json

from odoo import http
from odoo.http import request


class NzReceiptPortal(http.Controller):
    """Public portal controller for viewing and downloading POS receipts."""

    @http.route('/nz/receipt/<int:order_id>', type='http', auth='public')
    def view_receipt(self, order_id, token=None):
        """Render the HTML receipt page for a given POS order."""
        order = request.env['pos.order'].sudo().browse(order_id)

        if not order.exists() or order.nz_receipt_token != token:
            return 'Invalid or expired receipt link.'

        config = order.session_id.config_id
        extra_columns = []
        if config.nz_visible_product_columns:
            extra_columns = json.loads(config.nz_visible_product_columns)

        return request.render('nz_pos_receipt_designer.nz_web_receipt_page', {
            'order': order,
            'extra_columns': extra_columns,
        })

    @http.route('/nz/receipt/pdf/<int:order_id>', type='http', auth='public')
    def download_receipt_pdf(self, order_id, token=None):
        """Generate and serve a PDF version of the receipt."""
        order = request.env['pos.order'].sudo().browse(order_id)

        if not order.exists() or order.nz_receipt_token != token:
            return 'Invalid or expired receipt link.'

        config = order.session_id.config_id
        extra_columns = []
        if config.nz_visible_product_columns:
            extra_columns = json.loads(config.nz_visible_product_columns)

        line_rows = []
        seq = 1
        for line in order.lines:
            row = {
                'seq': seq,
                'product': line.product_id.display_name,
                'qty': line.qty,
                'unit_price': '%.2f' % line.price_unit,
                'subtotal': '%.2f' % line.price_subtotal_incl,
            }
            for col in extra_columns:
                row[col] = str(line.product_id[col] or '') if col in line.product_id else ''
            line_rows.append(row)
            seq += 1

        pdf_data = {
            'company_name': order.company_id.name,
            'company_phone': order.company_id.phone or '',
            'receipt_ref': order.name,
            'receipt_date': order.date_order.strftime('%d-%m-%Y %H:%M'),
            'tax_amount': '%.2f' % order.amount_tax,
            'grand_total': '%.2f' % order.amount_total,
            'extra_columns': extra_columns,
            'line_rows': line_rows,
            'qr_b64': order.nz_qr_image.decode() if order.nz_qr_image else '',
        }

        pdf_content, _ = request.env['ir.actions.report'].sudo()._render_qweb_pdf(
            request.env.ref('nz_pos_receipt_designer.nz_action_receipt_pdf'),
            res_ids=[order.id],
            data={'payload': pdf_data},
        )

        return request.make_response(pdf_content, [
            ('Content-Type', 'application/pdf'),
            ('Content-Disposition', f'attachment; filename="Receipt-{order.name}.pdf"'),
        ])
