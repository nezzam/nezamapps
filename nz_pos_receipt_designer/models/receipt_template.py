# -*- coding: utf-8 -*-
from odoo import fields, models


class NzReceiptTemplate(models.Model):
    """Model to store custom POS receipt templates with layout configuration."""

    _name = 'nz.receipt.template'
    _description = 'NZ Receipt Template'

    name = fields.Char(
        string='Template Name',
        required=True,
        help='Descriptive name for this receipt template',
    )
    layout_xml = fields.Text(
        string='Layout XML',
        help='The XML/HTML markup defining the receipt layout',
    )
    font_family = fields.Char(
        string='Font Family',
        default='Arial',
        help='CSS font family used in the receipt',
    )
    company_id = fields.Many2one(
        'res.company',
        string='Company',
        readonly=True,
        index=True,
        required=True,
        default=lambda self: self.env.company,
    )
    header_logo = fields.Binary(
        string='Header Logo',
        default=lambda self: self.env.company.logo,
    )
    visible_product_columns = fields.Text(
        string='Visible Product Columns',
        help='JSON list of product field names shown as extra receipt columns',
        default='[]',
    )
    column_layout_config = fields.Text(
        string='Column Layout Config',
        default='[]',
        help='Serialized column layout configuration',
    )

    # --- URL QR Section ---
    show_url_qr = fields.Boolean(
        string='Show URL QR Code',
        default=False,
    )
    url_qr_pixel_size = fields.Integer(
        string='URL QR Pixel Size',
        default=120,
        help='Width/height of the URL-based QR code in pixels (80–300)',
    )
    url_qr_alignment = fields.Selection(
        [('left', 'Left'), ('center', 'Center'), ('right', 'Right')],
        string='URL QR Alignment',
        default='center',
    )

    # --- Receipt-Content QR Section ---
    show_receipt_qr = fields.Boolean(
        string='Show Receipt QR Code',
        default=False,
    )
    receipt_qr_pixel_size = fields.Integer(
        string='Receipt QR Pixel Size',
        default=120,
        help='Width/height of the receipt-content QR code in pixels (80–300)',
    )
    receipt_qr_alignment = fields.Selection(
        [('left', 'Left'), ('center', 'Center'), ('right', 'Right')],
        string='Receipt QR Alignment',
        default='center',
    )

    # ---- Actions ----
    def btn_open_layout_editor(self):
        """Open the visual drag-and-drop receipt layout editor."""
        self.ensure_one()
        return {
            'type': 'ir.actions.client',
            'tag': 'nz_receipt_editor_action',
            'target': 'current',
            'params': {
                'template_id': self.id,
            },
        }
