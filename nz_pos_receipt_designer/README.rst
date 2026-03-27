NZ POS Receipt Designer
=======================

Design and customize your Point of Sale receipts with a powerful visual editor.

Features
--------

* **Multiple Templates** – Choose from Classic, Modern, or Compact row-based layouts.
* **Visual Editor** – Drag-and-drop fields, change fonts, upload logos, and edit text directly.
* **Dynamic Columns** – Add extra product fields (barcode, weight, category, etc.) as receipt columns.
* **QR Codes** – Generate receipt-content QR and custom URL QR codes with configurable size and alignment.
* **Shareable Receipts** – Each paid order gets a unique shareable link with a QR code.
* **PDF Export** – Customers can download a styled PDF receipt from the shareable link.
* **Per-POS Config** – Each POS can use a different receipt template.
* **Odoo 19 Compatible** – Built for Odoo 19 Community & Enterprise.

Installation
------------

1. Copy the ``nz_pos_receipt_designer`` folder into your custom addons path.
2. Update the apps list in Odoo.
3. Install **NZ POS Receipt Designer** from the Apps menu.

Usage
-----

1. Go to **Point of Sale > Configuration > Receipt Templates** to create or select a template.
2. Click **Open Layout Editor** to customize the receipt visually.
3. In **POS Configuration**, enable *Custom Receipt Template* and select your template.
4. Open POS, complete a sale, and see your custom receipt.

Dependencies
------------

* ``base``
* ``point_of_sale``
* ``web``
* Python package: ``qrcode``

License
-------

LGPL-3
