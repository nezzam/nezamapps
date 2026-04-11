{
    'name': 'Chart of Accounts Cleanup & Restore',
    'version': '17.0.1.0',
    'category': 'Accounting',
    'summary': 'Advanced module to delete all accounts with detailed tracking',
    'description': """
        Advanced module to add server action for deleting all accounts 
        with detailed confirmation, logging, and error tracking.

        Features:
        - Detailed confirmation wizard with warnings
        - Force delete option for protected accounts
        - Complete logging of all deletion operations
        - Error tracking and reporting
        - Menu for viewing deletion logs
        - Multi-step confirmation for safety
    """,
    'author': 'Nezam',
    'company': 'Nezam',
    'maintainer': 'Nezam',
    'website': "https://www.nezam.co",
    'support': 'support@nezam.co',
    'images': ['static/description/banner.gif'],
    'depends': ['account'],
    'data': [
        'security/ir.model.access.csv',
        'data/sequence.xml',
        'views/account_views.xml',
    ],
    'demo': [],
    'installable': True,
    'application': True,
    'auto_install': False,
    'license': 'LGPL-3',
}