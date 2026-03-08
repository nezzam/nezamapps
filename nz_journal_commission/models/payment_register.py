from odoo import models


class AccountPaymentRegister(models.TransientModel):
    _inherit = "account.payment.register"

    def _create_payment_vals_from_wizard(self, batch_result):
        vals = super()._create_payment_vals_from_wizard(batch_result)

        journal = self.journal_id
        print(f"commission_percentage: {journal.commission_percentage},commission_account_id: {journal.commission_account_id}")
        if not journal.commission_percentage or not journal.commission_account_id:
            return vals

        commission = self.amount * journal.commission_percentage / 100
        print(f"commission: {commission}")
        if commission <= 0:
            return vals

        vals['amount'] = self.amount - commission

        sign = -1 if self.payment_type == 'outbound' else 1

        vals['write_off_line_vals'].append({
            'name': 'Commission',
            'account_id': journal.commission_account_id.id,
            'partner_id': self.partner_id.id,
            'currency_id': self.currency_id.id,
            'amount_currency': sign * commission,
            'balance': sign * commission,
        })
        print(f"vals: {vals}")
        return vals
