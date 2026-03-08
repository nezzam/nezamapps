from odoo import models, fields, api, _
from odoo.exceptions import ValidationError
import logging

_logger = logging.getLogger(__name__)


class XAccountFinalWarningWizard(models.TransientModel):
    _name = 'x_account.final_warning_wizard'
    _description = 'Final Warning for Account Deletion'

    account_count = fields.Integer(
        string='Accounts to Delete',
        readonly=True
    )

    delete_protected = fields.Boolean(
        string='Delete Protected Accounts',
        readonly=True
    )

    final_confirmation = fields.Char(
        string='Type CONFIRM DELETE to proceed',
        required=True,
        help="Type 'CONFIRM DELETE' to proceed"
    )

    @api.model
    def default_get(self, fields):
        res = super(XAccountFinalWarningWizard, self).default_get(fields)
        if 'default_account_count' in self._context:
            res['account_count'] = self._context['default_account_count']
        if 'default_delete_protected' in self._context:
            res['delete_protected'] = self._context['default_delete_protected']
        return res

    def proceed_with_force_delete(self):
        self.ensure_one()

        if self.final_confirmation != 'CONFIRM DELETE':
            raise ValidationError(_("Type 'CONFIRM DELETE' to proceed"))

        try:
            # Get all account IDs
            all_account_ids = self.env['account.account'].search([]).ids
            total = len(all_account_ids)

            if total == 0:
                return self._show_result(_('No accounts'), _('No accounts to delete'), 'info')

            # Clear journal references
            self._clear_journal_references(all_account_ids)

            # Delete accounts one by one
            deleted = 0
            failed = []
            line_vals = []
            cleaner = self.env['account.cleaner']

            for account_id in all_account_ids:
                try:
                    # Fresh savepoint for each account
                    self.env.cr.execute("SAVEPOINT force_%s" % account_id)

                    account = self.env['account.account'].browse(account_id)
                    if not account.exists():
                        continue

                    snapshot = cleaner._build_account_snapshot(account)

                    account.unlink()
                    deleted += 1
                    line_vals.append(cleaner._build_log_line_vals(snapshot, 'deleted'))

                    # Release savepoint
                    self.env.cr.execute("RELEASE SAVEPOINT force_%s" % account_id)
                    self.env.cr.commit()

                except Exception as e:
                    error_msg = str(e)
                    _logger.warning(f'Failed to delete {account_id}: {error_msg}')

                    # Rollback and release
                    try:
                        self.env.cr.execute("ROLLBACK TO SAVEPOINT force_%s" % account_id)
                        self.env.cr.execute("RELEASE SAVEPOINT force_%s" % account_id)
                    except:
                        pass

                    account = self.env['account.account'].browse(account_id)
                    code = account.code if account.exists() else f"ID:{account_id}"

                    snapshot = cleaner._build_account_snapshot(account) if account.exists() else {
                        'name': code,
                        'code': code,
                    }

                    failed.append({
                        'code': code,
                        'reason': error_msg[:100]
                    })

                    # Commit to clear failed transaction
                    try:
                        self.env.cr.commit()
                    except:
                        pass

            # Create log
            log_entry = self._create_log(total, deleted, failed, line_vals)

            # Show results
            return self._show_force_results(total, deleted, failed, log_entry)

        except Exception as e:
            _logger.error(f'Force delete failed: {str(e)}')
            raise ValidationError(_('Failed: %s', str(e)))

    def _clear_journal_references(self, account_ids):
        """Clear journal references"""
        try:
            journals = self.env['account.journal'].search([
                ('default_account_id', 'in', account_ids)
            ])

            if journals:
                journals.write({'default_account_id': False})
                _logger.info(f'Cleared {len(journals)} journals')
                self.env.cr.commit()

        except Exception as e:
            _logger.warning(f'Failed to clear journals: {str(e)}')

    def _create_log(self, total, deleted, failed, line_vals):
        """Create log entry"""
        try:
            failed_codes = [acc['code'] for acc in failed[:10]]

            base_log_data = {
                'user_id': self.env.user.id,
                'total_accounts': total,
                'deleted_count': deleted,
                'force_delete': True,
                'failed_codes': ', '.join(failed_codes) if failed_codes else 'None',
                'notes': _('Force delete'),
            }

            log_data = dict(base_log_data)
            log_data['line_ids'] = [(0, 0, vals) for vals in line_vals]

            try:
                log_entry = self.env['x_account.cleaner.log'].create(log_data)
            except Exception as detailed_error:
                _logger.error(
                    'Detailed force-delete log creation failed. Falling back to basic log. Error: %s',
                    str(detailed_error),
                    exc_info=True,
                )
                log_entry = self.env['x_account.cleaner.log'].create(base_log_data)

            self.env.cr.commit()
            return log_entry

        except Exception as e:
            _logger.error(f'Failed to create log: {str(e)}')
            return None

    def _show_force_results(self, total, deleted, failed, log_entry):
        """Show force delete results"""
        message = [
            _('Force delete completed'),
            _('Total: %s', total),
            _('Deleted: %s', deleted),
        ]

        if failed:
            message.append(_('Failed: %s', len(failed)))
            if len(failed) <= 3:
                for acc in failed:
                    message.append(f"  - {acc['code']}: {acc['reason']}")

        if log_entry and log_entry.name:
            message.append(_('Log: %s', log_entry.name))

        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': _('Results'),
                'message': '\n'.join(message),
                'type': 'success' if deleted > 0 else 'warning',
                'sticky': True,
                'next': {
                    'type': 'ir.actions.act_window_close',
                }
            }
        }

    def _show_result(self, title, message, notif_type):
        """Show simple result"""
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': title,
                'message': message,
                'type': notif_type,
                'sticky': False,
            }
        }

    def cancel(self):
        return {
            'type': 'ir.actions.act_window_close'
        }