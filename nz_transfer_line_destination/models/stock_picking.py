from odoo import api, fields, models


class StockPicking(models.Model):
    _inherit = 'stock.picking'

    use_line_destination = fields.Boolean(
        string='Set Destination Per Operation',
        help='If enabled, destination location is defined on each operation line.',
    )

    @api.onchange('use_line_destination', 'location_dest_id')
    def _onchange_use_line_destination(self):
        self._sync_move_destinations_with_picking_destination()

    def _sync_move_destinations_with_picking_destination(self):
        for picking in self.filtered(lambda p: not p.use_line_destination and p.location_dest_id):
            editable_moves = picking.move_ids_without_package.filtered(
                lambda move: move.state not in ('done', 'cancel')
            )
            editable_moves.location_dest_id = picking.location_dest_id

    @api.model_create_multi
    def create(self, vals_list):
        pickings = super().create(vals_list)
        pickings._sync_move_destinations_with_picking_destination()
        return pickings

    def write(self, vals):
        result = super().write(vals)
        if {'use_line_destination', 'location_dest_id'} & set(vals):
            self._sync_move_destinations_with_picking_destination()
        return result
