# -*- coding: utf-8 -*-
from odoo import api, fields, models


class NzPosConfig(models.Model):
    """Extend POS configuration to support custom receipt templates."""

    _inherit = 'pos.config'

    nz_receipt_template_id = fields.Many2one(
        'nz.receipt.template',
        string='Receipt Template',
        help='Select a custom receipt template for this POS',
    )
    nz_layout_xml = fields.Text(
        related='nz_receipt_template_id.layout_xml',
        string='Layout XML',
        store=True,
    )
    nz_header_logo = fields.Binary(
        related='nz_receipt_template_id.header_logo',
        string='Header Logo',
        readonly=False,
        store=True,
    )
    nz_use_custom_receipt = fields.Boolean(
        string='Use Custom Receipt',
        help='Enable to use a custom receipt template instead of the default',
    )
    nz_font_family = fields.Char(
        related='nz_receipt_template_id.font_family',
        string='Receipt Font',
        store=True,
    )
    nz_visible_product_columns = fields.Text(
        compute='_compute_nz_visible_product_columns',
        store=True,
    )

    # QR features relayed from template
    nz_show_receipt_qr = fields.Boolean(
        string='Show Receipt QR',
        related='nz_receipt_template_id.show_receipt_qr',
        readonly=False,
        store=True,
    )
    nz_show_url_qr = fields.Boolean(
        string='Show URL QR',
        related='nz_receipt_template_id.show_url_qr',
        readonly=False,
        store=True,
    )
    nz_receipt_qr_pixel_size = fields.Integer(
        related='nz_receipt_template_id.receipt_qr_pixel_size',
        readonly=False,
        store=True,
    )
    nz_receipt_qr_alignment = fields.Selection(
        related='nz_receipt_template_id.receipt_qr_alignment',
        readonly=False,
        store=True,
    )
    nz_receipt_accent_color = fields.Char(
        string='Receipt Accent Color',
        default='#abc64b',
    )
    nz_receipt_bg_image = fields.Binary(
        string='Receipt Background Image',
    )

    @api.depends('nz_receipt_template_id', 'nz_receipt_template_id.visible_product_columns')
    def _compute_nz_visible_product_columns(self):
        for rec in self:
            tpl = rec.nz_receipt_template_id
            if tpl and tpl.visible_product_columns:
                rec.nz_visible_product_columns = tpl.visible_product_columns
            else:
                rec.nz_visible_product_columns = '[]'

    def btn_launch_receipt_editor(self):
        """Shortcut to open the receipt editor from POS config form."""
        self.ensure_one()
        if not self.nz_receipt_template_id:
            return False
        return {
            'type': 'ir.actions.client',
            'tag': 'nz_receipt_editor_action',
            'target': 'current',
            'params': {
                'template_id': self.nz_receipt_template_id.id,
            },
        }
