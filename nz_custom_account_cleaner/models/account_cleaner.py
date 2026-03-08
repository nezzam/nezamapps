import json

from odoo import models, fields, api, _
from odoo.exceptions import UserError
import logging

_logger = logging.getLogger(__name__)


class AccountCleaner(models.Model):
    _name = 'account.cleaner'
    _description = 'Account Cleaner'

    @api.model
    def delete_all_accounts(self):
        """
        Delete all accounts from account.account model with detailed logging
        """
        try:
            # Get all account IDs
            all_account_ids = self.env['account.account'].search([]).ids
            total_accounts = len(all_account_ids)

            if total_accounts == 0:
                return self._show_notification(
                    _('No Accounts'),
                    _('There are no accounts to delete.'),
                    'info'
                )

            _logger.info(f'Starting account deletion. Total accounts: {total_accounts}')

            # Process deletion safely
            results = self._process_accounts_deletion_simple(all_account_ids)

            # Create log entry
            log_entry = self._create_deletion_log_simple(results)

            # Commit transaction
            self.env.cr.commit()

            # Show results
            return self._show_detailed_results_simple(results, log_entry)

        except Exception as e:
            # Rollback on error
            try:
                self.env.cr.rollback()
            except:
                pass

            _logger.error(f'Unexpected error in delete_all_accounts: {str(e)}', exc_info=True)
            raise UserError(_('Unexpected error: %s', str(e)))

    def _process_accounts_deletion_simple(self, account_ids):
        """Process deletion of accounts - simple version"""
        deleted_ids = []
        failed = []
        protected = []
        referenced = []
        log_lines = []

        # Process each account individually
        for account_id in account_ids:
            try:
                account_snapshot = {}
                # Start fresh cursor for each account
                self.env.cr.execute("SAVEPOINT account_%s" % account_id)

                account = self.env['account.account'].browse(account_id)
                if not account.exists():
                    continue

                account_snapshot = self._build_account_snapshot(account)

                # Check if account is protected
                is_protected, reason = self._check_if_protected_simple(account)
                if is_protected:
                    protected.append({
                        'id': account.id,
                        'code': account.code,
                        'reason': reason
                    })
                    self.env.cr.execute("RELEASE SAVEPOINT account_%s" % account_id)
                    continue

                # Try to unlink
                account.unlink()
                deleted_ids.append(account.id)
                log_lines.append(self._build_log_line_vals(account_snapshot, 'deleted'))

                # Release savepoint
                self.env.cr.execute("RELEASE SAVEPOINT account_%s" % account_id)

                # Commit after each successful deletion
                self.env.cr.commit()

            except Exception as e:
                error_msg = str(e)
                _logger.warning(f'Failed to delete account {account_id}: {error_msg}')

                # Rollback this account's savepoint
                try:
                    self.env.cr.execute("ROLLBACK TO SAVEPOINT account_%s" % account_id)
                    self.env.cr.execute("RELEASE SAVEPOINT account_%s" % account_id)
                except:
                    pass

                # Get account details
                account = self.env['account.account'].browse(account_id)
                code = account.code if account.exists() else f"ID:{account_id}"

                # Categorize error
                if self._is_protection_error(error_msg):
                    protected.append({
                        'id': account_id,
                        'code': code,
                        'reason': error_msg
                    })
                elif self._is_reference_error(error_msg):
                    referenced.append({
                        'id': account_id,
                        'code': code,
                        'reason': 'Has references'
                    })
                else:
                    failed.append({
                        'id': account_id,
                        'code': code,
                        'reason': error_msg[:100]
                    })

                # Commit to clear failed transaction
                try:
                    self.env.cr.commit()
                except:
                    pass

        return {
            'total': len(account_ids),
            'deleted_ids': deleted_ids,
            'failed': failed,
            'protected': protected,
            'referenced': referenced,
            'deleted_count': len(deleted_ids),
            'failed_count': len(failed),
            'protected_count': len(protected),
            'referenced_count': len(referenced),
            'line_vals': log_lines,
        }

    def _build_account_snapshot(self, account):
        """Build serializable snapshot for account restore"""
        fields_to_capture = {}
        for field_name, field in account._fields.items():
            if field_name in ('id', 'display_name', '__last_update'):
                continue
            if field.type == 'one2many':
                continue
            if field.related or field.compute or not field.store:
                continue

            value = account[field_name]
            if field.type == 'many2one':
                fields_to_capture[field_name] = value.id if value else False
            elif field.type == 'many2many':
                fields_to_capture[field_name] = value.ids if value else []
            else:
                fields_to_capture[field_name] = value

        # Required/important values that may be non-stored or computed in account.account
        fields_to_capture['code'] = account.code
        fields_to_capture['name'] = account.name
        fields_to_capture['account_type'] = account.account_type
        fields_to_capture['reconcile'] = account.reconcile
        fields_to_capture['currency_id'] = account.currency_id.id if account.currency_id else False
        fields_to_capture['allowed_journal_ids'] = account.allowed_journal_ids.ids
        fields_to_capture['group_id'] = account.group_id.id if account.group_id else False
        fields_to_capture['non_trade'] = account.non_trade
        fields_to_capture['tag_ids'] = account.tag_ids.ids
        fields_to_capture['tax_ids'] = account.tax_ids.ids
        fields_to_capture['company_ids'] = account.company_ids.ids

        return fields_to_capture

    def _build_log_line_vals(self, snapshot, state, reason=False):
        company_ids = snapshot.get('company_ids') or []
        company_id = snapshot.get('company_id') or (company_ids[0] if company_ids else False)
        return {
            'account_name': snapshot.get('name') or False,
            'account_code': snapshot.get('code') or False,
            'account_type': snapshot.get('account_type'),
            'currency_id': snapshot.get('currency_id') or False,
            'reconcile': bool(snapshot.get('reconcile')),
            'allowed_journal_ids': [(6, 0, snapshot.get('allowed_journal_ids') or [])],
            'group_id': snapshot.get('group_id') or False,
            'non_trade': bool(snapshot.get('non_trade')),
            'tag_ids': [(6, 0, snapshot.get('tag_ids') or [])],
            'tax_ids': [(6, 0, snapshot.get('tax_ids') or [])],
            'company_id': company_id,
            'deletion_state': state,
            'reason': reason or False,
            'snapshot_data': json.dumps(snapshot, default=str),
        }

    def _check_if_protected_simple(self, account):
        """Check if account is protected from deletion"""
        try:
            if not account.exists():
                return False, 'Account does not exist'

            # Check account type in Odoo 18
            protected_account_types = [
                'asset_receivable',
                'liability_payable',
                'asset_cash',
                'liability_credit_card',
            ]

            if hasattr(account, 'account_type'):
                if account.account_type in protected_account_types:
                    return True, _('System account type: %s', account.account_type)

            # Check if used in journals
            journal = self.env['account.journal'].search([
                ('default_account_id', '=', account.id)
            ], limit=1)

            if journal:
                return True, _('Used in journal: %s', journal.name)

            # Check if has entries
            move_lines = self.env['account.move.line'].search([
                ('account_id', '=', account.id)
            ], limit=1)

            if move_lines:
                return True, _('Has accounting entries')

            return False, ''

        except Exception as e:
            _logger.warning(f'Error checking protection: {str(e)}')
            return False, 'Error checking'

    def _is_protection_error(self, error_msg):
        """Check if error is a protection error"""
        if not error_msg:
            return False
        error_lower = error_msg.lower()
        protection_keywords = ['protected', 'restrict', 'cannot delete', 'not allowed']
        return any(keyword in error_lower for keyword in protection_keywords)

    def _is_reference_error(self, error_msg):
        """Check if error is a foreign key reference error"""
        if not error_msg:
            return False
        error_lower = error_msg.lower()
        reference_keywords = ['foreign key', 'reference', 'constraint']
        return any(keyword in error_lower for keyword in reference_keywords)

    def _create_deletion_log_simple(self, results):
        """Create a detailed log entry"""
        try:
            deleted_codes = [
                line.get('account_code')
                for line in results.get('line_vals', [])
                if line.get('deletion_state') == 'deleted' and line.get('account_code')
            ]

            base_log_data = {
                'user_id': self.env.user.id,
                'total_accounts': results['total'],
                'deleted_count': results['deleted_count'],
                'protected_count': results['protected_count'],
                'deleted_codes': ', '.join(deleted_codes) if deleted_codes else 'None',
                'protected_codes': ', '.join([acc['code'] for acc in results['protected'][:20]]) if results[
                    'protected'] else 'None',
                'referenced_codes': ', '.join([acc['code'] for acc in results['referenced'][:20]]) if results[
                    'referenced'] else 'None',
                'failed_codes': ', '.join([acc['code'] for acc in results['failed'][:20]]) if results[
                    'failed'] else 'None',
                'notes': _('Account deletion operation'),
                'force_delete': False,
            }

            log_data = dict(base_log_data)
            log_data['line_ids'] = [(0, 0, line_vals) for line_vals in results.get('line_vals', [])]

            try:
                log_entry = self.env['x_account.cleaner.log'].create(log_data)
            except Exception as detailed_error:
                _logger.error(
                    'Detailed log creation failed. Falling back to basic log. Error: %s',
                    str(detailed_error),
                    exc_info=True,
                )
                log_entry = self.env['x_account.cleaner.log'].create(base_log_data)

            self.env.cr.commit()

            return log_entry

        except Exception as e:
            _logger.error(f'Error creating log: {str(e)}')
            return None

    def _show_detailed_results_simple(self, results, log_entry):
        """Show detailed results"""
        try:
            message_parts = []

            if results['deleted_count'] > 0:
                message_parts.append(_('✅ Deleted: %s accounts', results['deleted_count']))

            if results['protected_count'] > 0:
                message_parts.append(_('🛡️ Protected: %s accounts', results['protected_count']))

            if results['referenced_count'] > 0:
                message_parts.append(_('🔗 Referenced: %s accounts', results['referenced_count']))

            if results['failed_count'] > 0:
                message_parts.append(_('❌ Failed: %s accounts', results['failed_count']))

            message_parts.append(_('📊 Total: %s accounts', results['total']))

            if log_entry and log_entry.name:
                message_parts.append(_('📝 Log: %s', log_entry.name))

            # Add details if needed
            if results['protected'] and len(results['protected']) <= 5:
                message_parts.append(_('\nProtected accounts:'))
                for acc in results['protected']:
                    message_parts.append(f"  - {acc['code']}: {acc['reason']}")

            # Determine notification type
            notif_type = 'success' if results['deleted_count'] > 0 else 'warning'
            title = _('Deletion Complete') if results['deleted_count'] > 0 else _('Partial Deletion')

            return {
                'type': 'ir.actions.client',
                'tag': 'display_notification',
                'params': {
                    'title': title,
                    'message': '\n'.join(message_parts),
                    'type': notif_type,
                    'sticky': True,
                    'next': {
                        'type': 'ir.actions.act_window_close',
                    }
                }
            }

        except Exception as e:
            _logger.error(f'Error showing results: {str(e)}')
            # Simple fallback
            return {
                'type': 'ir.actions.client',
                'tag': 'display_notification',
                'params': {
                    'title': _('Processed'),
                    'message': _('Processed %s accounts', results.get('total', 0)),
                    'type': 'info',
                    'sticky': True,
                }
            }

    def _show_notification(self, title, message, notif_type):
        """Helper to show notifications"""
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

    @api.model
    def delete_all_accounts_with_confirmation(self):
        """
        Open confirmation wizard before deleting accounts
        """
        try:
            # Check permissions
            if not self.env.user.has_group('account.group_account_manager'):
                raise UserError(_('Permission denied'))

            # Get account count
            accounts = self.env['account.account'].search([])
            total = len(accounts)

            if total == 0:
                return self._show_notification(
                    _('No Accounts'),
                    _('No accounts to delete.'),
                    'info'
                )

            # Simple analysis
            protected = 0
            for account in accounts:
                if self.env['account.journal'].search([('default_account_id', '=', account.id)], limit=1):
                    protected += 1
                elif self.env['account.move.line'].search([('account_id', '=', account.id)], limit=1):
                    protected += 1

            # Prepare warning
            warnings = []
            warnings.append(_('Total accounts: %s', total))
            if protected > 0:
                warnings.append(_('Protected accounts: %s', protected))

            return {
                'name': _('Confirm Deletion'),
                'type': 'ir.actions.act_window',
                'res_model': 'x_account.delete.confirmation.wizard',
                'view_mode': 'form',
                'target': 'new',
                'context': {
                    'default_account_count': total,
                    'default_warning_message': '\n'.join(warnings),
                },
            }

        except Exception as e:
            _logger.error(f'Error in confirmation: {str(e)}')
            raise UserError(_('Error: %s', str(e)))