/** @odoo-module **/
/**
 * nz_ctrl_click_new_tab
 *
 * Enables CTRL+Click (Cmd+Click on macOS) to open Odoo backend records
 * in a new browser tab.
 *
 * Odoo 19 already supports CTRL+click natively via the t-custom-click directive
 * for List View rows, Kanban cards, and Smart Buttons.
 * This module adds the missing coverage for:
 *   - Readonly Many2one field links (<a class="o_form_uri">) — fixed via XML patch
 *   - Breadcrumb navigation links
 *   - Any other backend <a> elements whose click handlers call preventDefault
 *
 * Strategy:
 *   A capture-phase mousedown listener detects CTRL/CMD + left-click and flags
 *   the event. A capture-phase click listener then intercepts elements where
 *   Odoo prevents the default browser behavior and routes them to window.open.
 */

import { browser } from "@web/core/browser/browser";
import { isMacOS } from "@web/core/browser/feature_detection";

/**
 * Returns true if the OS-appropriate modifier key is held.
 * @param {MouseEvent} ev
 */
function isCtrlClick(ev) {
    return isMacOS() ? ev.metaKey : ev.ctrlKey;
}

/**
 * Safety-net listener: intercepts CTRL+click on backend anchor elements
 * whose Odoo click-handlers would otherwise call preventDefault / stopPropagation,
 * blocking the browser's native "open in new tab" behaviour.
 *
 * Elements already handled by Odoo's t-custom-click (list rows, kanban cards,
 * stat buttons) are excluded; this listener only acts on plain <a> tags.
 */
document.addEventListener(
    "click",
    (ev) => {
        if (!isCtrlClick(ev) || ev.button !== 0) {
            return;
        }

        // Find the closest <a> ancestor of the clicked element.
        const anchor = ev.target.closest("a[href]");
        if (!anchor) {
            return;
        }

        const href = anchor.getAttribute("href");
        // Ignore pure fragment anchors (#) and javascript: hrefs.
        if (!href || href === "#" || href.startsWith("javascript:")) {
            return;
        }

        // Only act inside the backend application wrapper.
        if (!anchor.closest(".o_web_client, .o_action_manager")) {
            return;
        }

        // Let t-custom-click elements (list/kanban/stat-buttons) handle themselves.
        // They already pass isMiddleClick=true when CTRL is held.
        if (
            anchor.closest(
                ".o_data_row td, .o_kanban_record, .oe_stat_button, [t-custom-click]"
            )
        ) {
            return;
        }

        // At this point we have a CTRL+click on an internal backend link whose
        // handler prevents default.  Open the resolved URL in a new tab.
        ev.preventDefault();
        ev.stopPropagation();

        const url = new URL(href, browser.location.origin).toString();
        browser.open(url, "_blank");
    },
    true // capture phase — runs before Odoo's bubble-phase handlers
);
