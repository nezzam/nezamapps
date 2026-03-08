from odoo import models, fields, api, _
from odoo.exceptions import ValidationError


class XAccountDeleteConfirmationWizard(models.TransientModel):
    _name = 'x_account.delete.confirmation.wizard'
    _description = 'Account Deletion Confirmation Wizard'

    account_count = fields.Integer(
        string='Accounts to Delete',
        readonly=True
    )

    warning_message = fields.Text(
        string='Warning',
        readonly=True
    )

    confirmation_text = fields.Char(
        string='Type DELETE to confirm',
        required=True
    )

    delete_protected = fields.Boolean(
        string='Force Delete',
        default=False
    )

    @api.model
    def default_get(self, fields):
        res = super(XAccountDeleteConfirmationWizard, self).default_get(fields)
        accounts = self.env['account.account'].search([])
        res['account_count'] = len(accounts)

        # Simple warning
        warning = f"Accounts to delete: {len(accounts)}\n"
        warning += "This action cannot be undone!"
        res['warning_message'] = warning

        return res

    def confirm_delete(self):
        self.ensure_one()

        if self.confirmation_text != 'DELETE':
            raise ValidationError(_("Type 'DELETE' to confirm"))

        if self.delete_protected:
            return {
                'type': 'ir.actions.act_window',
                'name': _('Final Warning'),
                'res_model': 'x_account.final_warning_wizard',
                'view_mode': 'form',
                'target': 'new',
                'context': {
                    'default_account_count': self.account_count,
                }
            }

        cleaner = self.env['account.cleaner']
        return cleaner.delete_all_accounts()