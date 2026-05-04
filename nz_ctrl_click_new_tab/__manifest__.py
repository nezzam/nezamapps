# -*- coding: utf-8 -*-
{
    'name': 'CTRL + Click to Open New Tab',
    'version': '19.0.1.0.0',
    'summary': 'Hold CTRL (or Cmd on macOS) and click any record to open it in a new browser tab.',
    'description': '''
        Enables CTRL+Click (Cmd+Click on macOS) to open Odoo backend records
        in a new browser tab across List View, Kanban, Form View,
        Many2One fields, and Smart Buttons.
    ''',
    'category': 'Technical',
    'author': 'Nezam',
    'website': '',
    'license': 'LGPL-3',
    'depends': ['web'],
    'data': [],
    'assets': {
        'web.assets_backend': [
            'nz_ctrl_click_new_tab/static/src/xml/ctrl_click_patch.xml',
            'nz_ctrl_click_new_tab/static/src/js/ctrl_click_new_tab.js',
        ],
    },
    'installable': True,
    'auto_install': False,
    'application': False,
}
