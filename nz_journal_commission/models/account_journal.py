# -*- coding: utf-8 -*-

from odoo import models, fields

class AccountJournal(models.Model):
    _inherit = "account.journal"

    commission_percentage = fields.Float(
        string="Commission Percentage (%)"
    )

    commission_account_id = fields.Many2one(
        "account.account",
        string="Commission Account")
        # domain="[('deprecated', '=', False)]")


