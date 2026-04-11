import json
import base64
import io

from odoo import models, fields, api, _
from odoo.exceptions import UserError
import xlsxwriter

class XAccountCleanerLog(models.Model):
    _name = 'x_account.cleaner.log'
    _description = 'Account Deletion Log'
    _order = 'deletion_date desc'
    _rec_name = 'name'

    name = fields.Char(
        string='Reference',
        default=lambda self: self._get_default_name()
    )

    user_id = fields.Many2one(
        'res.users',
        string='User',
        required=True,
        default=lambda self: self.env.user
    )

    deletion_date = fields.Datetime(
        string='Deletion Date',
        default=fields.Datetime.now
    )

    # Statistics
    total_accounts = fields.Integer(string='Total Accounts')
    deleted_count = fields.Integer(string='Deleted Accounts')
    protected_count = fields.Integer(string='Protected Accounts')

    # Details
    deleted_codes = fields.Text(string='Deleted Account Codes')
    protected_codes = fields.Text(string='Protected Account Codes')
    referenced_codes = fields.Text(string='Referenced Account Codes')
    failed_codes = fields.Text(string='Failed Account Codes')

    notes = fields.Text(string='Additional Notes')

    force_delete = fields.Boolean(string='Force Delete Used', default=False)

    line_ids = fields.One2many(
        'x_account.cleaner.log.line',
        'log_id',
        string='Account Lines',
        domain=[('deletion_state', '=', 'deleted')]
    )

    def _get_default_name(self):
        """Generate default name from sequence"""
        return self.env['ir.sequence'].next_by_code('x_account.cleaner.log') or 'LOG-000'

    def action_restore_marked_accounts(self):
        self.ensure_one()
        lines = self.line_ids.filtered(
            lambda line: line.to_restore and line.deletion_state == 'deleted'
        )
        if not lines:
            return {
                'type': 'ir.actions.client',
                'tag': 'display_notification',
                'params': {
                    'title': _('No Lines Selected'),
                    'message': _('Please mark deleted lines to restore.'),
                    'type': 'warning',
                    'sticky': False,
                }
            }
        return lines.action_restore_lines()

    def action_select_all_lines(self):
        self.ensure_one()
        self.line_ids.filtered(
            lambda line: line.deletion_state == 'deleted'
        ).write({'to_restore': True})
        return {
            'type': 'ir.actions.act_window',
            'name': _('Account Deletion Log'),
            'res_model': 'x_account.cleaner.log',
            'res_id': self.id,
            'view_mode': 'form',
            'target': 'current',
        }

    def action_unselect_all_lines(self):
        self.ensure_one()
        self.line_ids.write({'to_restore': False})
        return {
            'type': 'ir.actions.act_window',
            'name': _('Account Deletion Log'),
            'res_model': 'x_account.cleaner.log',
            'res_id': self.id,
            'view_mode': 'form',
            'target': 'current',
        }

    def action_view_details(self):
        """View detailed log"""
        self.ensure_one()

        message_lines = []

        if self.deleted_count > 0:
            message_lines.append(f"✅ Deleted: {self.deleted_count} accounts")
            if self.deleted_codes and self.deleted_codes != 'None':
                message_lines.append(f"   Codes: {self.deleted_codes}")

        if self.protected_count > 0:
            message_lines.append(f"🛡️ Protected: {self.protected_count} accounts")
            if self.protected_codes and self.protected_codes != 'None':
                message_lines.append(f"   Codes: {self.protected_codes}")

        if self.referenced_codes and self.referenced_codes != 'None':
            message_lines.append(f"🔗 Referenced codes: {self.referenced_codes}")

        if self.failed_codes and self.failed_codes != 'None':
            message_lines.append(f"❌ Failed codes: {self.failed_codes}")

        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': f'Log Details: {self.name}',
                'message': '\n'.join(message_lines),
                'type': 'info',
                'sticky': True,
            }
        }

    def action_export_deleted_accounts_xlsx(self):
        self.ensure_one()

        deleted_lines = self.env['x_account.cleaner.log.line'].search([
            ('log_id', '=', self.id),
            ('deletion_state', '=', 'deleted'),
        ], order='account_code, id')

        if not deleted_lines:
            raise UserError(_('No deleted chart of accounts found in this log.'))

        account_type_labels = {}
        account_type_field = self.env['account.account']._fields.get('account_type')
        if account_type_field:
            account_type_labels = dict(account_type_field._description_selection(self.env))

        output = io.BytesIO()
        workbook = xlsxwriter.Workbook(output, {'in_memory': True})
        sheet = workbook.add_worksheet('Chart of Accounts')

        header_format = workbook.add_format({'bold': True})

        headers = ['Code', 'Account Name', 'Type', 'Allow Reconciliation']
        sheet.write_row(0, 0, headers, header_format)

        sheet.set_column(0, 0, 16)
        sheet.set_column(1, 1, 38)
        sheet.set_column(2, 2, 24)
        sheet.set_column(3, 3, 22)

        row = 1
        for line in deleted_lines:
            account_type_value = line.account_type or ''
            account_type_label = account_type_labels.get(account_type_value, account_type_value)

            sheet.write(row, 0, line.account_code or '')
            sheet.write(row, 1, line.account_name or '')
            sheet.write(row, 2, account_type_label or '')
            sheet.write(row, 3, 1 if line.reconcile else 0)
            row += 1

        workbook.close()
        output.seek(0)

        filename = '%s_chart_of_accounts.xlsx' % (self.name or 'account_deletion_log')
        filename = filename.replace('/', '_')

        attachment = self.env['ir.attachment'].create({
            'name': filename,
            'type': 'binary',
            'datas': base64.b64encode(output.read()),
            'mimetype': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'res_model': self._name,
            'res_id': self.id,
        })

        return {
            'type': 'ir.actions.act_url',
            'url': '/web/content/%s?download=true' % attachment.id,
            'target': 'self',
        }


class XAccountCleanerLogLine(models.Model):
    _name = 'x_account.cleaner.log.line'
    _description = 'Account Deletion Log Line'
    _order = 'id asc'

    log_id = fields.Many2one(
        'x_account.cleaner.log',
        string='Log',
        required=True,
        ondelete='cascade'
    )

    to_restore = fields.Boolean(string='Restore')

    account_name = fields.Char(string='Account Name')
    account_code = fields.Char(string='Account Code')
    account_type = fields.Char(string='Account Type')
    currency_id = fields.Many2one('res.currency', string='Currency')
    reconcile = fields.Boolean(string='Allow Reconciliation')
    allowed_journal_ids = fields.Many2many('account.journal', string='Allowed Journals')
    group_id = fields.Many2one('account.group', string='Group')
    non_trade = fields.Boolean(string='Non Trade')
    tag_ids = fields.Many2many('account.account.tag', string='Tags')
    tax_ids = fields.Many2many('account.tax', string='Taxes')
    company_id = fields.Many2one('res.company', string='Company')

    deletion_state = fields.Selection([
        ('deleted', 'Deleted'),
        ('protected', 'Protected'),
        ('referenced', 'Referenced'),
        ('failed', 'Failed'),
    ], string='Deletion Status', default='deleted', required=True)

    reason = fields.Char(string='Reason')
    snapshot_data = fields.Text(string='Snapshot Data')

    visible_for_restore = fields.Boolean(
        string='Visible for Restore',
        compute='_compute_visible_for_restore',
        search='_search_visible_for_restore'
    )

    @api.depends('deletion_state', 'account_code', 'company_id')
    def _compute_visible_for_restore(self):
        for line in self:
            line.visible_for_restore = (
                line.deletion_state == 'deleted'
                and not line._account_exists_in_chart()
            )

    def _search_visible_for_restore(self, operator, value):
        if operator not in ('=', '!='):
            return [('id', '=', 0)]

        target = bool(value)
        candidate_lines = self.search([
            ('deletion_state', '=', 'deleted'),
        ])
        visible_ids = candidate_lines.filtered(lambda line: not line._account_exists_in_chart()).ids

        if operator == '!=':
            target = not target

        if target:
            return [('id', 'in', visible_ids)]
        return [('id', 'not in', visible_ids)]

    def _account_exists_in_chart(self):
        self.ensure_one()
        if not self.account_code:
            return False
        domain = [('code', '=', self.account_code)]
        if self.company_id:
            domain.append(('company_ids', 'in', self.company_id.id))
        return bool(self.env['account.account'].search(domain, limit=1))

    def action_restore_lines(self):
        accounts_model = self.env['account.account']
        restored = 0
        failed = 0
        skipped = 0

        for line in self:
            update_vals = {'to_restore': False}

            if line.deletion_state != 'deleted':
                line.write(update_vals)
                skipped += 1
                continue

            snapshot = line._load_snapshot_values()
            if not snapshot:
                line.write(update_vals)
                failed += 1
                continue

            company_id = snapshot.get('company_id') or line.company_id.id
            code = snapshot.get('code') or line.account_code
            duplicate_domain = [('code', '=', code)]
            if company_id:
                duplicate_domain.append(('company_ids', 'in', company_id))

            existing = accounts_model.search(duplicate_domain, limit=1)
            if existing:
                line.write(update_vals)
                skipped += 1
                continue

            create_vals = line._prepare_account_create_vals(snapshot)

            try:
                with self.env.cr.savepoint():
                    accounts_model.create(create_vals)
                line.write(update_vals)
                restored += 1
            except Exception as error:
                minimal_vals = line._prepare_minimal_account_vals(snapshot)
                try:
                    with self.env.cr.savepoint():
                        account = accounts_model.create(minimal_vals)
                        optional_write_vals = line._prepare_optional_write_vals(snapshot)
                        if optional_write_vals:
                            account.write(optional_write_vals)
                    line.write(update_vals)
                    restored += 1
                except Exception as fallback_error:
                    line_message = _(
                        'Restore failed. Main: %s | Fallback: %s',
                        str(error)[:110],
                        str(fallback_error)[:110],
                    )
                    if line.reason:
                        line_message = '%s | %s' % (line.reason, line_message)
                    update_vals['reason'] = line_message
                    line.write(update_vals)
                    failed += 1

        message = _('Restored: %s | Failed: %s | Skipped: %s') % (restored, failed, skipped)
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': _('Restore Results'),
                'message': message,
                'type': 'success' if restored else 'warning',
                'sticky': True,
            }
        }

    def _load_snapshot_values(self):
        self.ensure_one()
        if not self.snapshot_data:
            return {}
        try:
            snapshot = json.loads(self.snapshot_data)
            if not snapshot.get('code'):
                code_store = snapshot.get('code_store')
                if isinstance(code_store, dict) and code_store:
                    snapshot['code'] = next(iter(code_store.values()))
            return snapshot
        except Exception:
            return {}

    def _prepare_account_create_vals(self, snapshot):
        self.ensure_one()
        vals = {
            'name': snapshot.get('name') or self.account_name or _('Restored Account'),
            'code': snapshot.get('code') or self.account_code,
            'account_type': snapshot.get('account_type') or self.account_type or 'expense',
            'reconcile': bool(snapshot.get('reconcile')),
            'currency_id': snapshot.get('currency_id') or False,
            'group_id': snapshot.get('group_id') or False,
            'non_trade': bool(snapshot.get('non_trade')),
            'company_ids': [(6, 0, snapshot.get('company_ids') or ([self.company_id.id] if self.company_id else [self.env.company.id]))],
            'allowed_journal_ids': [(6, 0, snapshot.get('allowed_journal_ids') or [])],
            'tag_ids': [(6, 0, snapshot.get('tag_ids') or [])],
            'tax_ids': [(6, 0, snapshot.get('tax_ids') or [])],
        }

        if vals['account_type'] in ('asset_receivable', 'liability_payable'):
            vals['reconcile'] = True
        if vals['account_type'] == 'off_balance':
            vals['reconcile'] = False
            vals['tax_ids'] = [(6, 0, [])]

        account_fields = self.env['account.account']._fields
        cleaned_vals = {
            key: value
            for key, value in vals.items()
            if key in account_fields and (value not in (None, '') or key in ('currency_id', 'group_id'))
        }
        return cleaned_vals

    def _prepare_minimal_account_vals(self, snapshot):
        self.ensure_one()
        vals = {
            'name': snapshot.get('name') or self.account_name or _('Restored Account'),
            'code': snapshot.get('code') or self.account_code,
            'account_type': snapshot.get('account_type') or self.account_type or 'expense',
            'company_ids': [(6, 0, snapshot.get('company_ids') or ([self.company_id.id] if self.company_id else [self.env.company.id]))],
            'reconcile': bool(snapshot.get('reconcile')),
        }

        if vals['account_type'] in ('asset_receivable', 'liability_payable'):
            vals['reconcile'] = True
        if vals['account_type'] == 'off_balance':
            vals['reconcile'] = False

        return vals

    def _prepare_optional_write_vals(self, snapshot):
        self.ensure_one()
        vals = {
            'currency_id': snapshot.get('currency_id') or False,
            'group_id': snapshot.get('group_id') or False,
            'non_trade': bool(snapshot.get('non_trade')),
            'allowed_journal_ids': [(6, 0, snapshot.get('allowed_journal_ids') or [])],
            'tag_ids': [(6, 0, snapshot.get('tag_ids') or [])],
            'tax_ids': [(6, 0, snapshot.get('tax_ids') or [])],
        }

        account_type = snapshot.get('account_type') or self.account_type
        if account_type == 'off_balance':
            vals['tax_ids'] = [(6, 0, [])]

        account_fields = self.env['account.account']._fields
        return {key: value for key, value in vals.items() if key in account_fields}