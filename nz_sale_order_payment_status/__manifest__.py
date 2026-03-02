# -*- coding: utf-8 -*-
{
    "name": "Order Payment Status",
    "version": "1.0.0",
    "category": "Sales",
    "summary": "Payment status, paid amount, remaining amount and progress on quotations",
    "description": """
Show payment status on quotations and sale orders.
Includes:
- Payment Status (No Payment / Partial / Fully Paid)
- Paid Amount
- Remaining Amount
- Payment Progress %
- Smart Button for invoices
""",
    "author": "Nezam",
    "depends": ["sale", "account"],
    "data": [
        "views/sale_order_views.xml",
    ],
    "installable": True,
    "application": False,
    "license": "LGPL-3",
}


