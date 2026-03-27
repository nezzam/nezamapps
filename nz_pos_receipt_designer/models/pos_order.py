# -*- coding: utf-8 -*-
import base64
import io
import uuid

import qrcode

from odoo import fields, models


class NzPosOrder(models.Model):
    """Extend POS orders to generate a unique QR code per receipt."""

    _inherit = 'pos.order'

    nz_qr_image = fields.Binary(string='Receipt QR Image')
    nz_receipt_token = fields.Char(string='Receipt Access Token')

    def _nz_generate_receipt_qr(self):
        """Create a unique QR code containing a shareable receipt URL."""
        base_url = self.env['ir.config_parameter'].sudo().get_param('web.base.url')

        for order in self:
            token = str(uuid.uuid4())
            receipt_url = f'{base_url}/nz/receipt/{order.id}?token={token}'

            qr_obj = qrcode.QRCode(
                version=1,
                error_correction=qrcode.constants.ERROR_CORRECT_M,
                box_size=8,
                border=3,
            )
            qr_obj.add_data(receipt_url)
            qr_obj.make(fit=True)

            img = qr_obj.make_image(fill_color='black', back_color='white').convert('RGB')
            buffer = io.BytesIO()
            img.save(buffer, format='PNG')

            order.nz_receipt_token = token
            order.nz_qr_image = base64.b64encode(buffer.getvalue()).decode()

    def action_pos_order_paid(self):
        """After payment, automatically generate the receipt QR code."""
        result = super().action_pos_order_paid()
        self._nz_generate_receipt_qr()
        return result
