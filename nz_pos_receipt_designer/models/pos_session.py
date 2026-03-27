# -*- coding: utf-8 -*-
from odoo import models


class NzPosSession(models.Model):
    """Extend POS session for receipt designer compatibility."""

    _inherit = 'pos.session'

    # In Odoo 19, pos.config automatically loads all its stored fields
    # to the POS frontend via _load_pos_data_fields.
    # Our custom nz_* fields on pos.config are included via the
    # _load_pos_data_fields override in pos_config.py.
    # No session-level overrides are needed.
