# -*- coding: utf-8 -*-

from odoo import models, fields, api


class SaleOrder(models.Model):
    _inherit = "sale.order"

    payment_state = fields.Selection(
        [
            ("no_payment", "No Payment"),
            ("partial_payment", "Partial Payment"),
            ("full_payment", "Fully Paid"),
        ], string="Payment Status", compute="_compute_payment_info", store=True, readonly=True)

    paid_amount = fields.Monetary("Paid Amount", compute="_compute_payment_info", store=True, readonly=True,)
    remaining_amount = fields.Monetary("Remaining Amount", compute="_compute_payment_info", store=True, readonly=True)
    payment_progress = fields.Float("Payment Progress (%)", compute="_compute_payment_progress", store=True, readonly=True)

    @api.depends(
        "invoice_ids.state",
        "invoice_ids.amount_total",
        "invoice_ids.amount_residual",
        "amount_total",
    )
    def _compute_payment_info(self):
        for order in self:
            total_paid = 0.0
            order_total = order.amount_total or 0.0

            posted_invoices = order.invoice_ids.filtered(
                lambda i: i.state == "posted" and i.move_type == "out_invoice"
            )

            for invoice in posted_invoices:
                total_paid += invoice.amount_total - invoice.amount_residual

            order.paid_amount = total_paid
            order.remaining_amount = max(order_total - total_paid, 0.0)

            if total_paid <= 0:
                order.payment_state = "no_payment"
            elif total_paid < order_total:
                order.payment_state = "partial_payment"
            else:
                order.payment_state = "full_payment"

    @api.depends("paid_amount", "remaining_amount")
    def _compute_payment_progress(self):
        for order in self:
            total = order.paid_amount + order.remaining_amount
            if total:
                order.payment_progress = (order.paid_amount / total) * 100
                # order.payment_progress = min((paid / total) * 100, 100)
            else:
                order.payment_progress = 0.0

