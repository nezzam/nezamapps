{
    'name': 'Stock Transfer Line Destination',
    'version': '17.0.1.0.0',
    'summary': 'Set destination location per operation line in transfers',
    'category': 'Inventory/Inventory',
    'depends': ['stock','account'],
    'data': [
        'views/stock_picking_views.xml',
        'views/refund_menu.xml',
    ],
    'installable': True,
    'application': False,
    'license': 'LGPL-3',
}
