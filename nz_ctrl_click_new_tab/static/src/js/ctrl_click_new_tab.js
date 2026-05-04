/** @odoo-module **/
/**
 * nz_ctrl_click_new_tab — Odoo 18 edition
 *
 * Enables CTRL+Click (Cmd+Click on macOS) to open Odoo backend records
 * in a new browser tab.
 *
 * Coverage:
 *   ✅ List View rows
 *   ✅ Kanban cards
 *   ✅ Readonly Many2one field links (a.o_form_uri)
 *   ✅ Smart Buttons (oe_stat_button)
 *   ✅ Breadcrumb and other internal backend anchors
 *
 * Strategy:
 *   1. Patch ListRenderer.onCellClicked — detect CTRL/Cmd, build URL, open new tab.
 *   2. Patch KanbanRecord.onGlobalClick — same.
 *   3. Patch Many2OneField.onClick — same.
 *   4. Patch ViewButton.onClick — intercepts CTRL+click on ALL stat buttons:
 *        - type="action"  → stateToUrl({ action: name }) — no server call needed
 *        - type="object"  → async RPC to get the action dict, then stateToUrl
 *   5. A capture-phase click listener handles remaining <a href> elements
 *      (breadcrumbs, action-based hrefs, etc.).
 */

import { patch } from "@web/core/utils/patch";
import { browser } from "@web/core/browser/browser";
import { isMacOS } from "@web/core/browser/feature_detection";
import { stateToUrl } from "@web/core/browser/router";
import { ListRenderer } from "@web/views/list/list_renderer";
import { KanbanRecord } from "@web/views/kanban/kanban_record";
import { Many2OneField } from "@web/views/fields/many2one/many2one_field";
import { ViewButton } from "@web/views/view_button/view_button";

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

/**
 * Returns true when the OS-appropriate modifier key is held.
 * @param {MouseEvent} ev
 */
function isCtrlClick(ev) {
    return isMacOS() ? ev.metaKey : ev.ctrlKey;
}

/**
 * Converts a model technical name to the URL path segment used by Odoo 18.
 * Models that contain a dot are used verbatim; models without a dot (rare)
 * receive the "m-" prefix — mirrors the urlRelation getter in Many2OneField.
 *
 * @param {string} model  e.g. "sale.order" | "res.partner"
 * @returns {string}      e.g. "sale.order" | "m-partner"
 */
function modelToSlug(model) {
    return model.includes(".") ? model : "m-" + model;
}

/**
 * Builds the canonical backend URL for a record.
 * @param {string} resModel
 * @param {number} resId
 * @returns {string}  e.g. "/odoo/sale.order/42"
 */
function getRecordUrl(resModel, resId) {
    return `/odoo/${modelToSlug(resModel)}/${resId}`;
}

// ---------------------------------------------------------------------------
// 1. Patch ListRenderer — intercept CTRL+click on data rows
// ---------------------------------------------------------------------------

patch(ListRenderer.prototype, {
    /**
     * @override
     */
    async onCellClicked(record, column, ev) {
        // Only intercept plain CTRL/Cmd + left-click on a non-editable row.
        // Let normal edit-mode clicks fall through to the original handler.
        if (
            isCtrlClick(ev) &&
            ev.button === 0 &&
            !this.isInlineEditable(record) &&
            !this.props.archInfo.noOpen &&
            record.resId
        ) {
            ev.preventDefault();
            ev.stopPropagation();
            const url = getRecordUrl(record.resModel, record.resId);
            browser.open(url, "_blank");
            return;
        }
        return super.onCellClicked(record, column, ev);
    },
});

// ---------------------------------------------------------------------------
// 2. Patch KanbanRecord — intercept CTRL+click on kanban cards
// ---------------------------------------------------------------------------

patch(KanbanRecord.prototype, {
    /**
     * @override
     */
    onGlobalClick(ev) {
        if (!isCtrlClick(ev) || ev.button !== 0) {
            return super.onGlobalClick(ev);
        }

        const { record, archInfo, forceGlobalClick } = this.props;

        // Only open in new tab when the card would normally open the record.
        if (forceGlobalClick || archInfo.canOpenRecords) {
            if (record.resId) {
                ev.preventDefault();
                ev.stopPropagation();
                const url = getRecordUrl(record.resModel, record.resId);
                browser.open(url, "_blank");
                return;
            }
        }

        return super.onGlobalClick(ev);
    },
});

// ---------------------------------------------------------------------------
// 3. Patch Many2OneField — intercept CTRL+click on readonly o_form_uri links
// ---------------------------------------------------------------------------

patch(Many2OneField.prototype, {
    /**
     * @override
     * In Odoo 18 the readonly anchor uses t-on-click.prevent="onClick".
     * We detect the modifier here and open the href in a new tab instead
     * of navigating via openAction().
     */
    onClick(ev) {
        if (isCtrlClick(ev) && this.props.canOpen && this.props.readonly) {
            // The anchor's href is already set to /odoo/{model}/{id}
            const anchor = ev.target.closest("a[href]");
            if (anchor) {
                const href = anchor.getAttribute("href");
                if (href && href !== "#" && !href.startsWith("javascript:")) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    const url = new URL(href, browser.location.origin).toString();
                    browser.open(url, "_blank");
                    return;
                }
            }
        }
        return super.onClick(ev);
    },
});

// ---------------------------------------------------------------------------
// 4. Patch ViewButton — intercept CTRL+click on ALL stat buttons
// ---------------------------------------------------------------------------
// Handles both:
//   type="action"  → stateToUrl({ action: name }) directly — no server call
//   type="object"  → async RPC to call the Python method and get the returned
//                    action dict, then stateToUrl({ action: result.id })
//
// Note: ViewButton.props.record carries resModel / resId / context.

patch(ViewButton.prototype, {
    /**
     * @override
     * @param {MouseEvent} ev
     */
    async onClick(ev) {
        if (!isCtrlClick(ev) || ev.button !== 0) {
            return super.onClick(ev);
        }

        const params = this.clickParams;
        if (!params.name || !params.type) {
            return super.onClick(ev);
        }

        // type="action" — URL can be built immediately without a server call.
        if (params.type === "action") {
            ev.preventDefault();
            ev.stopPropagation();
            const actionKey = isNaN(params.name)
                ? params.name
                : parseInt(params.name, 10);
            const url = stateToUrl({ action: actionKey });
            browser.open(url, "_blank");
            return;
        }

        // type="object" — must call the Python method to discover the action.
        if (params.type === "object") {
            const record = this.props.record;
            if (!record || !record.resModel || !record.resId) {
                return super.onClick(ev);
            }

            ev.preventDefault();
            ev.stopPropagation();

            try {
                const orm = this.env.services.orm;
                // Evaluate the button context if any.
                let buttonContext = {};
                if (params.context) {
                    if (typeof params.context === "string") {
                        try {
                            buttonContext = JSON.parse(params.context);
                        } catch (_) {}
                    } else {
                        buttonContext = params.context;
                    }
                }
                const ctx = Object.assign({}, record.context || {}, buttonContext);

                // Call the Python method; it typically returns a window action dict.
                const result = await orm.call(
                    record.resModel,
                    params.name,
                    [[record.resId]],
                    { context: ctx }
                );

                if (result && result.type === "ir.actions.act_window" && result.res_id && result.res_model) {
                    // Action opens a specific record — build a direct record URL
                    // (e.g. Journal Entry smart button → /odoo/account.move/33).
                    const url = getRecordUrl(result.res_model, result.res_id);
                    browser.open(url, "_blank");
                } else if (result && result.type === "ir.actions.act_window" && result.id) {
                    // Multi-record action with a stored DB id — open the action list.
                    const url = stateToUrl({ action: result.id });
                    browser.open(url, "_blank");
                } else if (result && result.type === "ir.actions.act_window") {
                    // Inline action without a stored ID — use xml_id if present.
                    const url = stateToUrl({
                        action: result.xml_id || result.id,
                        model: result.res_model,
                    });
                    browser.open(url, "_blank");
                } else {
                    // Non-window action (URL action, client action, etc.) — open normally.
                    return super.onClick(ev);
                }
            } catch (_err) {
                // On failure fall through to the normal handler.
                return super.onClick(ev);
            }
            return;
        }

        // Any other type — fall through.
        return super.onClick(ev);
    },
});

// ---------------------------------------------------------------------------
// 5. Capture-phase global listener — breadcrumbs & remaining backend anchors
// ---------------------------------------------------------------------------

/**
 * Safety-net for any backend <a href> elements not covered by the patches
 * above (breadcrumb links, action-based hrefs, etc.).
 */
document.addEventListener(
    "click",
    (ev) => {
        if (!isCtrlClick(ev) || ev.button !== 0) {
            return;
        }

        const anchor = ev.target.closest("a[href]");
        if (!anchor) {
            return;
        }

        const href = anchor.getAttribute("href");
        if (!href || href === "#" || href.startsWith("javascript:")) {
            return;
        }

        // Only act inside the backend application wrapper.
        if (!anchor.closest(".o_web_client, .o_action_manager")) {
            return;
        }

        // Skip list data rows, kanban cards and stat-buttons — handled by
        // the patches above (ViewButton/ListRenderer/KanbanRecord).
        if (
            anchor.closest(
                ".o_data_row td, .o_kanban_record, .oe_stat_button, .o_stat_button, [t-custom-click]"
            )
        ) {
            return;
        }

        ev.preventDefault();
        ev.stopPropagation();

        const url = new URL(href, browser.location.origin).toString();
        browser.open(url, "_blank");
    },
    true // capture phase — runs before Odoo's bubble-phase handlers
);
