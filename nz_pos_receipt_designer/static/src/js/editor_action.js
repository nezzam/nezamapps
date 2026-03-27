/** @odoo-module **/
import { registry } from "@web/core/registry";
import { Component, useState, useRef, onMounted, onWillStart } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { ConfirmationDialog } from "@web/core/confirmation_dialog/confirmation_dialog";


class NzReceiptEditorAction extends Component {
    static template = "nz_pos_receipt_designer.NzEditorTemplate";

    setup() {
        this.orm = useService("orm");
        this.notification = useService("notification");
        this.dialog = useService("dialog");

        this.editorRef = useRef("NzEditorCanvas");
        this.urlInputRef = useRef("nzUrlInput");

        this.chosenProductColumns = [];
        this.lastActiveTable = null;
        this.lastActiveColIdx = null;

        this.templateId =
            this.props.action?.params?.template_id ||
            this.props.action?.context?.active_id;

        this.configId = null;

        this.state = useState({
            fontFamily: "Arial",
            availableFields: [],
            headerLogo: "",
            prevLogo: "",
            prevLayout: "",
            currentLayout: "",
            selectedModel: "",
            showUrlQrPanel: false,
            showFieldPanel: true,
            draggedColumn: null,

            // QR controls
            urlQrSize: 120,
            urlQrAlign: "center",
            receiptQrSize: 120,
            receiptQrAlign: "center",
            enableReceiptQr: false,

            productFieldList: [],

            contextMenu: {
                visible: false,
                x: 0,
                y: 0,
                type: null,
                colIdx: null,
                pickedField: "",
            },
        });

        onWillStart(async () => {
            await this._fetchProductFieldList();
            await this._resolvePosConfigId();
            await this._fetchQrFlags();
            await this._fetchQrDimensions();
        });

        onMounted(async () => {
            await this._loadTemplateLayout();
            await this._rebuildSavedColumnsAuto();
            await this._rebuildSavedColumnsMaster();
            this._initRichTextEditor();
            this._guardPartialSelection();
            this._enableSpaceKey();

            if (this.state.enableReceiptQr) {
                this._renderReceiptQrPreview();
            }
        });
    }

    // ======================== QR SETTINGS ========================

    async _fetchQrDimensions() {
        if (!this.templateId) return;
        try {
            const [tpl] = await this.orm.read(
                "nz.receipt.template",
                [this.templateId],
                ["url_qr_pixel_size", "url_qr_alignment", "receipt_qr_pixel_size", "receipt_qr_alignment"]
            );
            if (tpl) {
                this.state.urlQrSize = tpl.url_qr_pixel_size || 120;
                this.state.urlQrAlign = tpl.url_qr_alignment || "center";
                this.state.receiptQrSize = tpl.receipt_qr_pixel_size || 120;
                this.state.receiptQrAlign = tpl.receipt_qr_alignment || "center";
            }
        } catch {
            this.state.urlQrSize = 120;
            this.state.urlQrAlign = "center";
            this.state.receiptQrSize = 120;
            this.state.receiptQrAlign = "center";
        }
    }

    onUrlQrSizeInput(ev) {
        this.state.urlQrSize = parseInt(ev.target.value);
        this._refreshUrlQrAppearance();
    }

    onUrlQrAlignChange(ev) {
        this.state.urlQrAlign = ev.target.value;
        this._refreshUrlQrAppearance();
    }

    onReceiptQrSizeInput(ev) {
        this.state.receiptQrSize = parseInt(ev.target.value);
        this._renderReceiptQrPreview();
    }

    onReceiptQrAlignChange(ev) {
        this.state.receiptQrAlign = ev.target.value;
        this._renderReceiptQrPreview();
    }

    _refreshUrlQrAppearance() {
        const canvas = this.editorRef.el;
        if (!canvas) return;
        const area = canvas.querySelector(".nz-url-qr-area");
        if (!area) return;
        const placeholder = area.querySelector(".nz-url-qr-box");
        if (!placeholder) return;

        const alignMap = { left: "flex-start", center: "center", right: "flex-end" };
        area.style.display = "flex";
        area.style.justifyContent = alignMap[this.state.urlQrAlign] || "center";

        const inner = placeholder.querySelector("div");
        if (inner) {
            const cvs = inner.querySelector("canvas");
            const img = inner.querySelector("img");
            if (cvs) { cvs.style.width = `${this.state.urlQrSize}px`; cvs.style.height = `${this.state.urlQrSize}px`; }
            if (img) { img.style.width = `${this.state.urlQrSize}px`; img.style.height = `${this.state.urlQrSize}px`; }
        }
    }

    _renderReceiptQrPreview() {
        if (!this.state.enableReceiptQr) return;
        const canvas = this.editorRef.el;
        if (!canvas) return;
        const wrapper = canvas.querySelector(".nz-receipt-qr-wrapper");
        if (!wrapper) return;

        wrapper.querySelector(".nz-receipt-qr-placeholder")?.remove();

        const srcImg = wrapper.querySelector(".nz-receipt-qr-source img");
        if (!srcImg) return;

        const holder = document.createElement("div");
        holder.className = "nz-receipt-qr-placeholder";
        const alignMap = { left: "flex-start", center: "center", right: "flex-end" };
        holder.style.display = "flex";
        holder.style.justifyContent = alignMap[this.state.receiptQrAlign] || "center";
        holder.style.marginTop = "12px";

        const cloned = srcImg.cloneNode(true);
        cloned.style.width = `${this.state.receiptQrSize}px`;
        cloned.style.height = `${this.state.receiptQrSize}px`;
        cloned.style.margin = "0";

        if (!this.props.data?.nz_qr_image) {
            const tmp = document.createElement("div");
            tmp.style.position = "absolute";
            tmp.style.left = "-9999px";
            document.body.appendChild(tmp);
            new QRCode(tmp, {
                text: "Demo Receipt QR",
                width: this.state.receiptQrSize,
                height: this.state.receiptQrSize,
                colorDark: "#000000",
                colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.H,
            });
            const qrCanvas = tmp.querySelector("canvas");
            const demoSrc = qrCanvas ? qrCanvas.toDataURL("image/png") : "";
            cloned.setAttribute("src", demoSrc);
            document.body.removeChild(tmp);
        }

        holder.appendChild(cloned);
        wrapper.appendChild(holder);
    }

    // ======================== FONT / LOGO ========================

    _applyFont() {
        if (!this.editorRef.el) return;
        const receiptDiv = this.editorRef.el.querySelector(".pos-receipt");
        if (receiptDiv) receiptDiv.style.fontFamily = this.state.fontFamily;
    }

    onFontPickerChange(ev) {
        this.state.fontFamily = ev.target.value;
        this._applyFont();
    }

    triggerLogoUpload() {
        document.getElementById("nzLogoUpload")?.click();
    }

    async onLogoFileSelected(ev) {
        const file = ev.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async () => {
            const b64 = reader.result.split(",")[1];
            this.state.currentLayout = this.editorRef.el.innerHTML;
            this.state.prevLogo = this.state.headerLogo;
            this.state.prevLayout = this.state.currentLayout;
            await this.orm.write("nz.receipt.template", [this.templateId], { header_logo: b64 });
            this.state.headerLogo = b64;
            await this._loadTemplateLayout();
            this.notification.add("Logo updated!", { type: "success" });
        };
        reader.readAsDataURL(file);
    }

    async _removeLogo() {
        try {
            this.state.headerLogo = false;
            this.state.prevLogo = false;
            const logoEl = this.editorRef.el.querySelector(".nz-receipt-logo");
            if (logoEl) logoEl.remove();
            await this.orm.write("nz.receipt.template", [this.templateId], { header_logo: false });
            await this._loadTemplateLayout();
            this.notification.add("Logo removed", { type: "success" });
        } catch (err) {
            console.error("NZ: logo removal error", err);
            this.notification.add("Failed to remove logo", { type: "danger" });
        }
    }

    // ======================== TEMPLATE LOADING ========================

    async _loadTemplateLayout(reset = false) {
        const [tpl] = await this.orm.searchRead(
            "nz.receipt.template",
            [["id", "=", this.templateId]],
            ["name", "layout_xml", "font_family", "header_logo"]
        );
        if (!tpl) return;

        this.state.fontFamily = tpl.font_family || "Arial";
        this.state.headerLogo = tpl.header_logo;

        if (!reset && this.editorRef.el?.innerHTML) {
            this.state.currentLayout = this.editorRef.el.innerHTML;
        } else {
            this.state.currentLayout = tpl.layout_xml;
        }

        let html = this.state.currentLayout;
        if (typeof html !== "string") {
            html = html ? String(html) : "";
        }

        let logo = (!reset || !this.state.prevLogo) ? this.state.headerLogo : this.state.prevLogo;
        this.state.headerLogo = logo;

        html = html.replace(/<img[^>]*class="nz-receipt-logo"[^>]*>/gi, "");
        html = html.replace(/<t t-else="">\s*<\/t>/gi, "");
        html = html.replace(/<t>\s*<\/t>/gi, "");

        if (logo) {
            html = html.replace(
                /<t t-if="props.order.config.nz_header_logo">[\s\S]*?<\/t>/,
                `<t t-if="props.order.config.nz_header_logo">
                    <img t-att-src="'data:image/png;base64,' + props.order.config.nz_header_logo"
                         class="nz-receipt-logo"/>
                </t>
                <t t-else="">
                <img src="data:image/png;base64,${logo}"
                     class="nz-receipt-logo" style="max-width:150px;height:auto;"/>
                </t>`
            );
        }

        this.editorRef.el.innerHTML = html;
        this._applyFont();
        this._activateColumnDropZones();
    }

    // ======================== SAVE / RESET ========================

    async onSaveClicked() {
        const snapshot = this.editorRef.el.cloneNode(true);

        if (this._isCompactLayout()) {
            snapshot.querySelectorAll(".nz-column-dropzone").forEach(dz => {
                dz.innerHTML = '<span class="nz-editor-only-label"></span>';
            });
        }

        this.state.currentLayout = snapshot.innerHTML;
        this.state.currentLayout = this.state.currentLayout.replace(/Display Name/gi, "");
        this.state.currentLayout = this.state.currentLayout.replace(/display_name/gi, "");

        const payload = {
            layout_xml: this.state.currentLayout,
            font_family: this.state.fontFamily,
            header_logo: this.state.headerLogo,
            show_receipt_qr: !!this.state.enableReceiptQr,
            show_url_qr: !!this.state.showUrlQrPanel,
        };

        try {
            payload.url_qr_pixel_size = this.state.urlQrSize;
            payload.url_qr_alignment = this.state.urlQrAlign;
            payload.receipt_qr_pixel_size = this.state.receiptQrSize;
            payload.receipt_qr_alignment = this.state.receiptQrAlign;
            await this.orm.write("nz.receipt.template", [this.templateId], payload);
        } catch {
            delete payload.url_qr_pixel_size;
            delete payload.url_qr_alignment;
            delete payload.receipt_qr_pixel_size;
            delete payload.receipt_qr_alignment;
            await this.orm.write("nz.receipt.template", [this.templateId], payload);
        }

        this.notification.add("Receipt template saved!", { type: "success" });
        setTimeout(() => window.location.reload(), 800);
    }

    async onResetClicked() {
        if (this.state.prevLayout) {
            this.state.currentLayout = this.state.prevLayout;
            this.editorRef.el.innerHTML = this.state.currentLayout;
        }
        await this._loadTemplateLayout(true);
        this.notification.add("Receipt layout reset!", { type: "success" });
    }

    // ======================== RICH TEXT EDITOR ========================

    _initRichTextEditor() {
        this.richEditor = new MediumEditor(this.editorRef.el, {
            toolbar: {
                buttons: ["bold", "italic", "underline", "strikethrough", "subscript", "superscript", "h1", "h3", "quote", "anchor"],
            },
            placeholder: false,
            targetBlank: true,
            disableExtraSpaces: true,
        });
    }

    _enableSpaceKey() {
        if (!this.editorRef.el) return;
        this.editorRef.el.addEventListener("keydown", (ev) => {
            if (ev.key === " " || ev.keyCode === 32) {
                const sel = window.getSelection();
                if (!sel.rangeCount) return;
                const range = sel.getRangeAt(0);
                if (range.startContainer.nodeType === Node.TEXT_NODE && range.startOffset === range.startContainer.length) {
                    ev.preventDefault();
                    document.execCommand("insertHTML", false, "&nbsp;");
                }
            }
        });
    }

    _guardPartialSelection() {
        document.addEventListener("selectionchange", () => {
            const sel = window.getSelection();
            if (!sel.rangeCount) return;
            const range = sel.getRangeAt(0);
            const startEl = range.startContainer.parentElement;
            const endEl = range.endContainer.parentElement;
            const ph = startEl.closest(".nz-field-placeholder") || endEl.closest(".nz-field-placeholder");
            if (ph && sel.toString() !== ph.textContent) {
                const nr = document.createRange();
                nr.selectNodeContents(ph);
                sel.removeAllRanges();
                sel.addRange(nr);
            }
        });
    }

    // ======================== POS CONFIG RESOLUTION ========================

    async _resolvePosConfigId() {
        if (!this.templateId) {
            this.notification.add("Template ID not found.", { type: "danger" });
            return;
        }
        const cfgs = await this.orm.searchRead(
            "pos.config",
            [["nz_receipt_template_id", "=", this.templateId]],
            ["id"],
            { limit: 1 }
        );
        if (cfgs[0]) this.configId = cfgs[0].id;
    }

    async _fetchQrFlags() {
        try {
            const [tpl] = await this.orm.read(
                "nz.receipt.template",
                [this.templateId],
                ["show_receipt_qr", "show_url_qr"]
            );
            this.state.enableReceiptQr = !!tpl?.show_receipt_qr;
            this.state.showUrlQrPanel = !!tpl?.show_url_qr;
        } catch {
            this.state.enableReceiptQr = false;
            this.state.showUrlQrPanel = false;
        }
    }

    // ======================== DRAG & DROP FOR FIELDS ========================

    async onModelPickerChange(ev) {
        const model = ev.target.value;
        this.state.selectedModel = model;
        if (!model) return (this.state.availableFields = []);
        const fieldsMeta = await this.orm.call(model, "fields_get", [], {});
        this.state.fieldsInfo = fieldsMeta;
        const prefix = model === "pos.order" ? "order" : model === "res.partner" ? "partner" : model;
        this.state.availableFields = Object.keys(fieldsMeta)
            .filter(k => !/(_ids?$|\d+$)/.test(k))
            .map(k => ({
                technical: `${prefix}.${k}`,
                label: odoo.debug ? `${fieldsMeta[k].string || k} (${prefix}.${k})` : fieldsMeta[k].string || k,
            }));
    }

    onFieldDragStart(ev) {
        const fieldToken = `[[${ev.target.dataset.field}]]`;
        ev.dataTransfer.setData("text/plain", fieldToken);
        ev.dataTransfer.effectAllowed = "copy";

        const ghost = document.createElement("div");
        ghost.textContent = fieldToken;
        ghost.style.padding = "6px 12px";
        ghost.style.fontSize = "12px";
        ghost.style.background = "#000";
        ghost.style.color = "#fff";
        ghost.style.borderRadius = "20px";
        ghost.style.pointerEvents = "none";
        ghost.style.position = "absolute";
        ghost.style.top = "-9999px";
        document.body.appendChild(ghost);
        ev.dataTransfer.setDragImage(ghost, 0, 0);
        setTimeout(() => ghost.remove(), 0);

        this.editorRef.el.classList.add("nz-dragging");
        this.editorRef.el.classList.add("nz-drop-highlight");
    }

    onFieldDragEnd() {
        this.editorRef.el.classList.remove("nz-dragging");
        this.editorRef.el.classList.remove("nz-drop-highlight");
    }

    onCanvasDrop(ev) {
        ev.preventDefault();
        if (ev.dataTransfer.types.includes("application/x-nz-column")) return;

        const restricted = ev.target.closest(".nz-no-drop");
        if (restricted) {
            this.notification.add("Cannot drop fields in this area.", { type: "warning" });
            return;
        }
        if (ev.target.closest(".nz-header-block")) return;

        const txt = ev.dataTransfer.getData("text/plain");
        if (!txt) return;

        const span = document.createElement("span");
        span.textContent = txt;
        span.classList.add("nz-field-placeholder");

        const existing = ev.target.closest(".nz-field-placeholder");
        if (existing) {
            existing.insertAdjacentElement("afterend", span);
            return;
        }

        let range = null;
        if (document.caretRangeFromPoint) range = document.caretRangeFromPoint(ev.clientX, ev.clientY);
        else if (document.caretPositionFromPoint) {
            const p = document.caretPositionFromPoint(ev.clientX, ev.clientY);
            if (p?.offsetNode) { range = document.createRange(); range.setStart(p.offsetNode, p.offset); range.collapse(true); }
        }
        if (range) range.insertNode(span);
        else this.editorRef.el.querySelector(".nz-drop-zone")?.appendChild(span);

        this.editorRef.el.classList.remove("nz-dragging", "nz-drop-highlight");
        span.classList.add("nz-added");
        setTimeout(() => span.classList.remove("nz-added"), 400);
    }

    // ======================== COLUMN DRAG & DROP ========================

    onColumnChipDragStart(ev) {
        ev.stopPropagation();
        ev.dataTransfer.setData("application/x-nz-column", ev.target.dataset.field);
        ev.dataTransfer.effectAllowed = "copy";
        this.editorRef.el.classList.add("nz-column-dragging");
    }

    async onProductColumnSelect(ev) {
        const fieldName = ev.target.value;
        if (!fieldName) return;
        const mockRows = await this._fetchMockProducts([fieldName]);
        this._insertColumnUniversal(fieldName, 0, mockRows);
    }

    _activateColumnDropZones() {
        const table = this.editorRef.el.querySelector(".nz-lines-table");
        if (this._isCompactLayout()) {
            this._activateCompactDropZones();
            return;
        }
        if (!table) return;

        const headers = table.querySelectorAll(".nz-column-dropzone th");
        headers.forEach((th, idx) => {
            th.addEventListener("dragover", (ev) => {
                if (ev.dataTransfer.types.includes("application/x-nz-column")) {
                    ev.preventDefault();
                    th.classList.add("nz-col-hover");
                }
            });
            th.addEventListener("dragleave", () => th.classList.remove("nz-col-hover"));
            th.addEventListener("drop", (ev) => {
                ev.preventDefault();
                th.classList.remove("nz-col-hover");
                const col = ev.dataTransfer.getData("application/x-nz-column");
                if (col) this._insertTableColumn(col, idx);
            });
        });
    }

    _activateCompactDropZones() {
        const zones = this.editorRef.el.querySelectorAll(".nz-column-dropzone");
        if (!zones) return;
        zones.forEach(zone => {
            zone.addEventListener("dragover", (ev) => {
                if (ev.dataTransfer.types.includes("application/x-nz-column")) {
                    ev.preventDefault();
                    zone.style.backgroundColor = "rgba(0, 123, 255, 0.1)";
                    zone.style.border = "2px dashed #007bff";
                }
            });
            zone.addEventListener("dragleave", () => {
                zone.style.backgroundColor = "";
                zone.style.border = "2px dashed #bbb";
            });
            zone.addEventListener("drop", (ev) => {
                zone.style.backgroundColor = "";
                zone.style.border = "2px dashed #bbb";
                this._onCompactColumnDrop(ev);
            });
        });
    }

    // ======================== TABLE COLUMN OPERATIONS ========================

    _insertTableColumn(fieldName, index, mockRows = null) {
        const table = this.editorRef.el.querySelector(".nz-lines-table");
        if (!table) return;

        const thead = table.querySelector("thead tr");
        const bodyRows = table.querySelectorAll("tbody tr");

        if (thead.querySelector(`[data-field="${fieldName}"]`)) {
            this.notification.add("Column already exists", { type: "warning" });
            return;
        }

        const existingDynCols = thead.querySelectorAll("th[data-field]");
        if (existingDynCols.length >= 1) {
            this.notification.add("Only one extra column allowed. Remove the existing one first.", { type: "warning" });
            return;
        }

        const statics = thead.querySelectorAll("th:not([data-field])");
        if (statics.length >= 3) {
            statics[0].style.width = "35%";
            statics[1].style.width = "12%";
            statics[2].style.width = "18%";
        }

        const th = document.createElement("th");
        th.dataset.field = fieldName;
        const fObj = this.state.productFieldList?.find(f => f.name === fieldName);
        th.textContent = fObj?.label || fieldName.replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase());
        th.style.textAlign = "center";
        th.style.width = "35%";
        th.style.padding = "12px";
        th.style.whiteSpace = "nowrap";
        th.style.fontSize = "12px";
        thead.appendChild(th);

        bodyRows.forEach((row, ri) => {
            const existingCell = row.querySelector(`td[data-field="${fieldName}"]`);
            if (existingCell) return;

            const sCells = row.querySelectorAll("td:not([data-field])");
            if (sCells.length >= 3) {
                sCells[0].style.width = "35%";
                sCells[1].style.width = "12%";
                sCells[2].style.width = "18%";
            }

            const td = document.createElement("td");
            td.dataset.field = fieldName;
            td.style.padding = "4px";
            td.style.textAlign = "center";
            td.style.width = "35%";

            let value = "";
            if (mockRows && Array.isArray(mockRows) && mockRows[ri]) {
                value = mockRows[ri][fieldName] || "";
                if (typeof value === "number") value = value.toFixed(2);
                else if (Array.isArray(value)) value = value[1] || value[0] || "";
                else if (typeof value === "boolean") value = value ? "Yes" : "No";
            }
            td.textContent = " ";
            row.appendChild(td);
        });

        this._persistSelectedColumns();
    }

    _persistSelectedColumns() {
        const table = this.editorRef.el.querySelector(".nz-lines-table");
        if (!table) return;
        const thead = table.querySelector("thead tr");
        if (!thead) return;
        const cols = [];
        [...thead.children].forEach(th => { if (th.dataset.field) cols.push(th.dataset.field); });
        this.chosenProductColumns = cols;
        if (this.templateId) {
            this.orm.write("nz.receipt.template", [this.templateId], {
                visible_product_columns: JSON.stringify(cols),
            });
        }
    }

    // ======================== COMPACT LAYOUT COLUMN OPS ========================

    _isCompactLayout() {
        return !!this.editorRef?.el?.querySelector(".nz-compact-row-layout");
    }

    _insertCompactColumn(fieldName, rowIdx, mockRows = null) {
        try {
            if (!this.editorRef?.el) return;
            const zones = this.editorRef.el.querySelectorAll(".nz-column-dropzone");
            if (!zones.length) {
                this.notification?.add?.("This template doesn't support dynamic fields", { type: "warning" });
                return;
            }

            if (this.editorRef.el.querySelector(`.nz-column-dropzone [data-field="${fieldName}"]`)) {
                this.notification?.add?.("Field already added", { type: "warning" });
                return;
            }

            const total = this.editorRef.el.querySelectorAll(".nz-column-dropzone [data-field]").length;
            if (total >= 3) {
                this.notification?.add?.("Maximum 3 extra fields. Remove some first.", { type: "warning" });
                return;
            }

            const fObj = this.state.productFieldList?.find(f => f.name === fieldName);
            const label = fObj?.label || fieldName.replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase());

            zones.forEach((zone, zi) => {
                if (zone.querySelector(`[data-field="${fieldName}"]`)) return;

                const row = document.createElement("div");
                row.dataset.field = fieldName;
                row.style.cssText = "display:flex; justify-content:space-between; align-items:flex-start; font-size:13px; margin-bottom:6px; padding:4px 0; cursor:pointer;";
                row.title = "Click to remove";

                const labelSpan = document.createElement("span");
                labelSpan.style.cssText = "opacity:0.7; font-weight:500;";
                labelSpan.textContent = label;

                const valSpan = document.createElement("span");
                valSpan.style.cssText = "font-weight:600; text-align:right; word-break:break-word; max-width:60%;";
                valSpan.classList.add("nz-field-placeholder");

                let val = "";
                if (mockRows && Array.isArray(mockRows) && mockRows[zi]) {
                    val = mockRows[zi][fieldName] || "";
                    if (typeof val === "number") val = val.toFixed(2);
                    else if (Array.isArray(val)) val = val[1] || val[0] || "";
                    else if (typeof val === "boolean") val = val ? "Yes" : "No";
                    valSpan.textContent = " ";
                } else {
                    valSpan.textContent = `[[ orderline.${fieldName} ]]`;
                }

                row.appendChild(labelSpan);
                row.appendChild(valSpan);
                zone.appendChild(row);
            });

            this._persistCompactColumns();
            this.notification?.add?.(`Field "${label}" added`, { type: "success" });
        } catch (err) {
            console.error("NZ: compact column insert error", err);
        }
    }

    _persistCompactColumns() {
        if (!this.editorRef?.el) return;
        const zones = this.editorRef.el.querySelectorAll(".nz-column-dropzone");
        const cols = [];
        zones.forEach(z => {
            z.querySelectorAll("[data-field]").forEach(el => {
                if (el.dataset.field && !cols.includes(el.dataset.field)) cols.push(el.dataset.field);
            });
        });
        this.chosenProductColumns = cols;
        if (this.templateId) {
            this.orm.write("nz.receipt.template", [this.templateId], {
                visible_product_columns: JSON.stringify(cols),
            });
        }
    }

    _removeCompactColumn(fieldName) {
        const els = this.editorRef.el.querySelectorAll(`.nz-column-dropzone [data-field="${fieldName}"]`);
        if (!els.length) return;
        els.forEach(el => el.remove());
        this._persistCompactColumns();
        this.notification?.add?.(`Field "${fieldName}" removed`, { type: "success" });
    }

    async _onCompactColumnDrop(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        const fieldName = ev.dataTransfer.getData("application/x-nz-column");
        if (!fieldName) return;
        let mockRows = null;
        try { mockRows = await this._fetchMockProducts([fieldName]); } catch { /* ignore */ }
        this._insertCompactColumn(fieldName, 0, mockRows);
        this.editorRef.el.classList.remove("nz-column-dragging");
    }

    // ======================== UNIVERSAL COLUMN HELPERS ========================

    _insertColumnUniversal(fieldName, index = 0, mockRows = null) {
        if (!fieldName || !this.editorRef?.el) return;
        if (this._isCompactLayout()) return this._insertCompactColumn(fieldName, index, mockRows);
        return this._insertTableColumn(fieldName, index, mockRows);
    }

    async _rebuildSavedColumnsAuto() {
        try {
            await new Promise(r => setTimeout(r, 100));
            if (this._isCompactLayout()) await this._rebuildCompactColumns();
            else await this._rebuildTableColumns();
        } catch (err) {
            console.error("NZ: column restore error", err);
        }
    }

    async _rebuildSavedColumnsMaster() {
        try {
            await new Promise(r => setTimeout(r, 100));
            if (this._isCompactLayout()) await this._rebuildCompactColumns();
            else await this._rebuildTableColumns();
        } catch (err) {
            console.error("NZ: master column rebuild error", err);
        }
    }

    async _rebuildTableColumns() {
        if (!this.templateId) return;
        let retries = 0;
        while (!this.editorRef.el?.querySelector(".nz-lines-table") && retries < 10) {
            await new Promise(r => setTimeout(r, 200));
            retries++;
        }
        const table = this.editorRef.el?.querySelector(".nz-lines-table");
        if (!table) return;

        const rec = await this.orm.read("nz.receipt.template", [this.templateId], ["visible_product_columns"]);
        const cols = JSON.parse(rec[0]?.visible_product_columns || "[]");
        if (!cols.length) return;

        const mockRows = await this._fetchMockProducts(cols);
        const thead = table.querySelector("thead tr");
        thead.querySelectorAll("th[data-field]").forEach(th => th.remove());
        table.querySelectorAll("td[data-field]").forEach(td => td.remove());
        cols.forEach(col => this._insertTableColumn(col, 2, mockRows));
    }

    async _rebuildCompactColumns() {
        if (!this.templateId) return;
        let retries = 0;
        while ((!this.editorRef?.el || !this.editorRef.el.querySelector(".nz-column-dropzone")) && retries < 10) {
            await new Promise(r => setTimeout(r, 200));
            retries++;
        }
        if (!this.editorRef?.el) return;

        const rec = await this.orm.read("nz.receipt.template", [this.templateId], ["visible_product_columns"]);
        let cols = [];
        try { cols = JSON.parse(rec[0]?.visible_product_columns || "[]"); } catch { return; }
        if (!cols.length) return;

        const mockRows = await this._fetchMockProducts(cols);
        for (const col of cols) this._insertCompactColumn(col, 0, mockRows);
    }

    async _fetchMockProducts(fields = []) {
        if (!Array.isArray(fields) || !fields.length) return [{ name: "Sample Product", qty: 1, price: 0 }];
        try {
            return await this.orm.searchRead("product.product", [], ["name", ...fields], { limit: 2 });
        } catch {
            return [];
        }
    }

    async _fetchProductFieldList() {
        const meta = await this.orm.call("product.product", "fields_get", [], {});
        this.state.productFieldList = Object.keys(meta)
            .filter(k => !/(_ids?$|\d+$)/.test(k))
            .map(k => ({ name: k, label: meta[k].string || k }));
    }

    // ======================== URL QR ========================

    toggleUrlQrPanel(ev) {
        const checked = ev.target.checked;
        const canvas = this.editorRef.el;
        const area = canvas?.querySelector(".nz-url-qr-area");
        if (!checked) {
            area?.querySelector(".nz-url-qr-box")?.remove();
            return;
        }
        this._generateUrlQr();
    }

    _generateUrlQr() {
        if (!this.state.showUrlQrPanel) return;
        const urlVal = this.urlInputRef.el?.value?.trim();
        if (!urlVal) {
            this.notification.add("Enter a URL first!", { type: "warning" });
            return;
        }

        const canvas = this.editorRef.el;
        const area = canvas?.querySelector(".nz-url-qr-area");
        if (!area) return;

        area.querySelector(".nz-url-qr-box")?.remove();

        const outer = document.createElement("div");
        outer.className = "nz-url-qr-box";
        const inner = document.createElement("div");
        outer.appendChild(inner);
        area.appendChild(outer);

        new QRCode(inner, {
            text: urlVal,
            width: this.state.urlQrSize,
            height: this.state.urlQrSize,
        });

        this._refreshUrlQrAppearance();
    }

    onSubmitUrlQr() {
        this._generateUrlQr();
    }

    toggleReceiptQr(ev) {
        this.state.enableReceiptQr = ev.target.checked;
        const wrapper = this.editorRef.el?.querySelector(".nz-receipt-qr-wrapper");
        if (!wrapper) return;
        wrapper.querySelector(".nz-receipt-qr-placeholder")?.remove();
        if (this.state.enableReceiptQr) this._renderReceiptQrPreview();
    }

    // ======================== EDITOR CLICK HANDLERS ========================

    async onEditorClick(ev) {
        if (this.editorRef.el.classList.contains("nz-column-dragging")) return;

        // Logo click → remove
        const logo = ev.target.closest(".nz-receipt-logo");
        if (logo) {
            this.dialog.add(ConfirmationDialog, {
                title: "Remove Logo",
                body: "Remove the logo from this receipt?",
                confirm: () => this._removeLogo(),
                cancel: () => {},
            });
            return;
        }

        // Compact layout field click → remove
        if (this._isCompactLayout()) {
            const fieldEl = ev.target.closest(".nz-compact-row-layout [data-field]");
            if (fieldEl) {
                const fName = fieldEl.dataset.field;
                this.dialog.add(ConfirmationDialog, {
                    title: "Remove Field",
                    body: `Remove field "${fName}"?`,
                    confirm: () => this._removeCompactColumn(fName),
                    cancel: () => {},
                });
            }
            return;
        }

        // Table column click → remove
        const table = ev.target.closest("table");
        if (!table) return;
        const th = ev.target.closest("th");
        if (!th) return;
        const colIdx = Array.from(th.parentNode.children).indexOf(th);
        const fName = th?.dataset?.field;
        if (!fName || colIdx < 3) {
            this.notification.add("Cannot remove default columns.", { type: "warning" });
            return;
        }

        this.lastActiveTable = table;
        this.lastActiveColIdx = colIdx;
        this.dialog.add(ConfirmationDialog, {
            title: "Remove Column",
            body: `Remove column "${fName}"?`,
            confirm: () => this._removeTableColumn(colIdx),
            cancel: () => {},
        });
    }

    async _removeTableColumn(colIdx = null) {
        if (!this.lastActiveTable) return;
        const table = this.lastActiveTable;
        const thead = table.querySelector("thead tr");
        const bodyRows = table.querySelectorAll("tbody tr");
        const idx = colIdx ?? this.lastActiveColIdx;
        if (idx == null || idx < 3) {
            this.notification.add("Cannot remove default columns.", { type: "warning" });
            return;
        }

        const th = thead.children[idx];
        const fieldName = th?.dataset?.field;
        if (!fieldName) return;

        const [rec] = await this.orm.searchRead(
            "nz.receipt.template",
            [["id", "=", this.templateId]],
            ["visible_product_columns"],
            { limit: 1 }
        );
        let saved = JSON.parse(rec?.visible_product_columns || "[]");
        saved = saved.filter(f => f !== fieldName);
        await this.orm.write("nz.receipt.template", [this.templateId], {
            visible_product_columns: JSON.stringify(saved),
        });

        th.remove();
        bodyRows.forEach(row => {
            const cell = row.querySelector(`td[data-field="${fieldName}"]`);
            if (cell) cell.remove();
        });

        this.notification.add(`Column "${fieldName}" removed`, { type: "success" });
        this.lastActiveTable = null;
        this.lastActiveColIdx = null;
    }
}

registry.category("actions").add("nz_receipt_editor_action", NzReceiptEditorAction);
