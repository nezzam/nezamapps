/** @odoo-module **/
/**
 * NZ POS Receipt Designer – Receipt Renderer (Odoo 19)
 *
 * Patches OrderReceipt to conditionally render a custom receipt layout
 * stored on pos.config.nz_layout_xml. In Odoo 19 the receipt component
 * receives the live PosOrder object as `props.order` — there is no
 * `export_for_printing()` method.
 */
import { OrderReceipt } from "@point_of_sale/app/screens/receipt_screen/receipt/order_receipt";
import { patch } from "@web/core/utils/patch";
import { qrCodeSrc } from "@point_of_sale/utils";
import { formatCurrency } from "@web/core/currency";
import { useState, Component, xml, useRef, onMounted } from "@odoo/owl";

patch(OrderReceipt.prototype, {
    setup() {
        super.setup();
        this.nzState = useState({ hasTemplate: true });
    },

    /* ------------------------------------------------------------------ */
    /*  Whether to fall back to the stock Odoo receipt                     */
    /* ------------------------------------------------------------------ */
    get nzUseDefault() {
        const cfg = this.props.order?.config;
        if (!cfg) return true;
        const active = cfg.nz_use_custom_receipt;
        const layout = cfg.nz_layout_xml;
        return !active || !layout || !layout.trim();
    },

    /* ------------------------------------------------------------------ */
    /*  Parse the raw layout XML, replacing [[ ]] placeholders            */
    /* ------------------------------------------------------------------ */
    nzParseLayoutXml(rawXml) {
        if (!rawXml) return "";
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(rawXml, "text/html");
            const order = this.props.order;
            const company = order?.company;
            const partner = order?.partner_id;

            // Re-inject dynamic product columns into the table header
            const columnsJson = order?.config?.nz_visible_product_columns || "[]";
            let extraColumns = [];
            try { extraColumns = JSON.parse(columnsJson); } catch { extraColumns = []; }

            if (extraColumns.length > 0) {
                const tbl = doc.querySelector(".nz-lines-table");
                const hdr = tbl?.querySelector("thead tr");
                if (hdr) {
                    extraColumns.forEach(col => {
                        if (!hdr.querySelector(`th[data-field="${col}"]`)) {
                            const th = document.createElement("th");
                            th.setAttribute("data-field", col);
                            th.style.textAlign = "center";
                            th.style.fontSize = "12px";
                            th.style.padding = "4px";
                            th.textContent = col.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
                            hdr.appendChild(th);
                        }
                    });
                }
            }

            // Normalise HTML
            let html = doc.body.innerHTML
                .replace(/<br\s*>/gi, "<br/>")
                .replace(/<hr\s*>/gi, "<hr/>")
                .replace(/&nbsp;|\u00A0/g, " ")
                .replace(/<img([^>]*)>/gi, "<img$1/>")
                .replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;)/g, "&amp;")
                .trim();

            // Apply font
            const fontFamily = order?.config?.nz_font_family || "Arial";
            html = html.replace(
                /<div([^>]*class="pos-receipt"[^>]*)>/i,
                (m, attrs) =>
                    `<div ${attrs.replace(/\s*style="[^"]*"/gi, "")} style="font-family:${fontFamily};">`
            );

            // Currency formatter
            const currencyId = order?.currency?.id;
            const fmtCurrency = (amount) => {
                try { return formatCurrency(amount || 0, currencyId); }
                catch { return String(amount || 0); }
            };

            // Replace currency placeholders
            html = html
                .replaceAll("[[ receipt.total_without_tax ]]",
                    fmtCurrency(order?.getTotalWithoutTax?.() || 0))
                .replaceAll("[[ receipt.amount_total ]]",
                    fmtCurrency(order?.getTotalWithTax?.() || 0));

            // Replace generic [[ field.path ]] placeholders
            const resolved = html.replace(
                /\[\[\s*([\w.\s]+)\s*\]\]/g,
                (match, fieldPath) => {
                    const path = fieldPath.trim().replace(/\s+/g, "");
                    let val = "";
                    if (path.startsWith("order.")) val = order?.[path.slice(6)];
                    else if (path.startsWith("partner.")) val = partner?.[path.slice(8)];
                    else if (path.startsWith("company.")) val = company?.[path.slice(8)];
                    return (val !== false && val != null) ? val : match;
                }
            );

            return resolved;
        } catch (err) {
            console.error("NZ Receipt: layout parsing error", err);
            return "";
        }
    },

    /* ------------------------------------------------------------------ */
    /*  Build template data from the live PosOrder (Odoo 19)              */
    /* ------------------------------------------------------------------ */
    get nzTemplateData() {
        const order = this.props.order;
        if (!order) {
            return { orderlines: [], receipt: {}, dynamic_fields: [], data: {} };
        }

        const cfg = order.config || {};
        let extraCols = [];
        try {
            extraCols = JSON.parse(cfg.nz_visible_product_columns || "[]");
        } catch {
            extraCols = [];
        }

        // Build enriched order lines with dynamic column values
        const orderlines = (order.lines || []).map(line => {
            const product = line.product_id;
            const dynVals = {};
            extraCols.forEach(col => {
                let v = product?.[col];
                if (v == null) v = "";
                else if (typeof v === "object") v = v.display_name || v.name || "";
                else v = String(v);
                dynVals[col] = v;
            });
            return {
                productName: product?.display_name || line.full_product_name || "",
                qty: line.qty,
                price: line.price_subtotal_incl,
                _dynamicValues: dynVals,
            };
        });

        // Build receipt-content QR (client-side, via Odoo barcode controller)
        let qrSrc = null;
        if (cfg.nz_show_receipt_qr) {
            if (order.finalized) {
                const qrPayload =
                    `ORDER=${order.name}` +
                    `,TOTAL=${(order.getTotalWithTax?.() || 0).toFixed(2)}` +
                    `,ITEMS=${(order.lines || []).length}`;
                qrSrc = qrCodeSrc(qrPayload);
            } else {
                qrSrc = qrCodeSrc("QR PREVIEW");
            }
        }

        return {
            order: order,
            orderlines: orderlines,
            receipt: {
                total_without_tax: order.getTotalWithoutTax?.() || 0,
                amount_total: order.getTotalWithTax?.() || 0,
                name: order.name || "",
                date: order.date_order
                    ? order.date_order.toLocaleString?.()
                        || String(order.date_order)
                    : "",
                qr_src: qrSrc,
            },
            dynamic_fields: extraCols,
            data: {
                nz_qr_image: null,      // server-side QR not available here
                qr_src: qrSrc,
            },
        };
    },

    /* ------------------------------------------------------------------ */
    /*  Dynamically build an OWL component from the layout XML            */
    /* ------------------------------------------------------------------ */
    get nzDynamicComponent() {
        try {
            const layoutXml = this.props.order?.config?.nz_layout_xml || "";
            if (!layoutXml) return null;

            const parsedHtml = this.nzParseLayoutXml(layoutXml);
            if (!parsedHtml) return null;

            return class extends Component {
                static template = xml`${parsedHtml}`;
                static props = {
                    order: { type: Object, optional: true },
                    receipt: { type: Object, optional: true },
                    orderlines: { type: Array, optional: true },
                    dynamic_fields: { type: Array, optional: true },
                    data: { type: Object, optional: true },
                };

                setup() {
                    this.rootRef = useRef("root");

                    onMounted(() => {
                        const el = this.rootRef.el;
                        if (!el) return;
                        const cfg = this.props.order?.config || {};

                        // --- Receipt-Content QR ---
                        let qrHolder = el.querySelector(".nz-receipt-qr-placeholder")
                            || el.querySelector("#nz_dynamic_qr_container");
                        let qrWrapper = el.querySelector(".nz-receipt-qr-wrapper");

                        if (cfg.nz_show_receipt_qr && !qrWrapper) {
                            qrWrapper = document.createElement("div");
                            qrWrapper.className = "nz-receipt-qr-wrapper";
                            const footer = el.querySelector(".nz-before-footer");
                            if (footer) footer.parentNode.insertBefore(qrWrapper, footer);
                            else el.appendChild(qrWrapper);
                        }

                        if (cfg.nz_show_receipt_qr && qrWrapper && !qrHolder) {
                            qrHolder = document.createElement("div");
                            qrHolder.className = "nz-receipt-qr-placeholder";
                            qrHolder.style.display = "flex";
                            qrHolder.style.marginTop = "10px";
                            qrWrapper.appendChild(qrHolder);
                        }

                        const qrSrc = this.props.receipt?.qr_src || this.props.data?.qr_src;
                        if (cfg.nz_show_receipt_qr && qrHolder && qrSrc) {
                            qrHolder.style.display = "flex";
                            const align = cfg.nz_receipt_qr_alignment || "center";
                            const flexMap = { left: "flex-start", center: "center", right: "flex-end" };
                            qrHolder.style.justifyContent = flexMap[align];
                            qrHolder.innerHTML = "";
                            const img = document.createElement("img");
                            img.src = qrSrc;
                            const px = cfg.nz_receipt_qr_pixel_size || 120;
                            img.style.width = `${px}px`;
                            img.style.height = `${px}px`;
                            qrHolder.appendChild(img);
                        } else if (qrHolder && !cfg.nz_show_receipt_qr) {
                            qrHolder.style.display = "none";
                        }

                        // --- URL QR ---
                        let urlQrArea = el.querySelector(".nz-url-qr-area");
                        if (cfg.nz_show_url_qr && !urlQrArea) {
                            urlQrArea = document.createElement("div");
                            urlQrArea.className = "nz-url-qr-area";
                            urlQrArea.style.display = "flex";
                            urlQrArea.style.justifyContent = "center";
                            urlQrArea.style.margin = "25px 0";
                            if (qrWrapper) qrWrapper.parentNode.insertBefore(urlQrArea, qrWrapper);
                            else el.appendChild(urlQrArea);
                        }
                        if (urlQrArea) {
                            if (!cfg.nz_show_url_qr) {
                                urlQrArea.style.display = "none";
                            } else {
                                urlQrArea.style.display = "flex";
                                const pos = cfg.url_qr_alignment || "center";
                                const fm = { left: "flex-start", center: "center", right: "flex-end" };
                                urlQrArea.style.justifyContent = fm[pos];
                            }
                        }
                    });
                }
            };
        } catch (err) {
            console.error("NZ Receipt: component build error", err);
            return null;
        }
    },
});
