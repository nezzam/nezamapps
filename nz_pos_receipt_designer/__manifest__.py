# -*- coding: utf-8 -*-
{
    'name': 'NZ POS Receipt Designer',
    'version': '19.0.1.0.0',
    'category': 'Point of Sale',
    'summary': "Design and customize POS receipts with drag-and-drop editor, "
               "QR codes, multiple templates, and dynamic product columns",
    'description': """
        NZ POS Receipt Designer
        =======================
        A powerful receipt designer for Odoo Point of Sale that allows you to:
        
        * Choose from multiple pre-built receipt templates
        * Customize receipt layout with a visual drag-and-drop editor
        * Add dynamic product columns to receipts
        * Include QR codes (URL-based and receipt-content-based)
        * Change fonts, logos, and styling
        * Generate shareable receipt links with QR codes
        * Export receipts as PDF
        
        Keywords: POS Receipt, Receipt Designer, POS Template, Receipt Customizer,
        Point of Sale Receipt, Custom Receipt, POS Layout, Receipt Editor
    """,
    'author': 'NZ Solutions',
    'company': 'NZ Solutions',
    'maintainer': 'NZ Solutions',
    'website': 'https://www.nzsolutions.com',
    'depends': ['base', 'point_of_sale', 'web'],
    'data': [
        'security/ir.model.access.csv',
        'data/receipt_template_classic.xml',
        'data/receipt_template_modern.xml',
        'data/receipt_template_compact.xml',
        'views/receipt_template_views.xml',
        'views/pos_config_views.xml',
        'views/web_receipt_page.xml',
        'report/receipt_pdf_report.xml',
    ],
    'assets': {
        'point_of_sale._assets_pos': [
            'nz_pos_receipt_designer/static/src/js/receipt_renderer.js',
            'nz_pos_receipt_designer/static/src/xml/order_receipt.xml',
        ],
        'web.assets_backend': [
            'nz_pos_receipt_designer/static/src/js/editor_action.js',
            'nz_pos_receipt_designer/static/src/xml/editor_template.xml',
            'nz_pos_receipt_designer/static/src/css/editor.css',
            'https://cdn.jsdelivr.net/npm/medium-editor@5.23.3/dist/js/medium-editor.min.js',
            'https://cdn.jsdelivr.net/npm/medium-editor@5.23.3/dist/css/medium-editor.min.css',
            'https://cdn.jsdelivr.net/npm/medium-editor@5.23.3/dist/css/themes/default.min.css',
            'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
        ],
    },
    'images': ['static/description/banner.png'],
    'license': 'LGPL-3',
    'installable': True,
    'auto_install': False,
    'application': False,
}
