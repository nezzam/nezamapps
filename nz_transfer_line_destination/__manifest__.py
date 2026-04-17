{
    'name': 'Stock Transfer Line Destination',
    'version': '18.0.1.0.0',
    'summary': 'Set destination location per operation line in transfers',
    'author': 'Nezam',
    'company': 'Nezam',
    'maintainer': 'Nezam',
    'website': "https://www.nezam.co",
    'support': 'support@nezam.co',
    'images': ['static/description/banner.gif'],
    'category': 'Inventory/Inventory',
    'depends': ['stock','account'],
    'data': [
        'views/stock_picking_views.xml',
    ],
    'installable': True,
    'application': False,
    'license': 'LGPL-3',
}
