/**
 * Floating-card UI preferences (position + collapsed) persisted in localStorage.
 * Mirrors key-store.js: storage is injectable and every access is guarded so the
 * card still works (just won't remember its spot) when storage is unavailable.
 */

export const STORAGE_KEY = 'vibe.ui.prefs';

// Nominal card geometry used to keep the draggable header reachable on-screen.
// Exact rendered size varies (collapsed/error), so we clamp against the header,
// which guarantees the child can always grab and move the card.
export const CARD_WIDTH = 300;
export const HEADER_H = 40;
export const EDGE_MARGIN = 8;
export const DEFAULT_CARD_H = 220;
// Keep the header below the Scratch menu bar (z-index 491 > our 480), so a card
// dragged/clamped to the top isn't painted behind it and left un-grabbable.
export const MENU_BAR_TOP = 48;

const defaultStorage = () =>
    (typeof window === 'undefined' ? null : window.localStorage);

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/**
 * @param {object} [storage] - defaults to window.localStorage
 * @returns {?{x:number,y:number,collapsed:boolean}} parsed prefs, or null if
 *   absent / storage unavailable / malformed.
 */
export const loadPrefs = function (storage = defaultStorage()) {
    if (!storage) return null;
    try {
        const raw = storage.getItem(STORAGE_KEY);
        if (typeof raw !== 'string') return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null;
        return {x: parsed.x, y: parsed.y, collapsed: Boolean(parsed.collapsed)};
    } catch (e) {
        return null;
    }
};

/**
 * @param {object} prefs - the prefs to persist ({x, y, collapsed})
 * @param {object} [storage] - defaults to window.localStorage
 * @returns {boolean} - true if persisted; false if storage rejected the write
 */
export const savePrefs = function (prefs, storage = defaultStorage()) {
    if (!storage) return false;
    try {
        storage.setItem(STORAGE_KEY, JSON.stringify({
            x: prefs.x,
            y: prefs.y,
            collapsed: Boolean(prefs.collapsed)
        }));
        return true;
    } catch (e) {
        return false;
    }
};

/**
 * Keep the card on-screen for the current viewport. `bounds="parent"` only
 * constrains live dragging; a stored coord from a larger/older window can be
 * off-screen, so we clamp on load. `cardHeight` is the visible height to keep
 * fully on-screen — pass DEFAULT_CARD_H when expanded so the body isn't below
 * the fold, or HEADER_H when collapsed (header-only).
 * @param {object} pos - the candidate {x, y} position
 * @param {object} viewport - {innerWidth, innerHeight} of the window
 * @param {number} [cardHeight=HEADER_H] - visible card height to keep on-screen
 * @returns {object} - the clamped {x, y} position
 */
export const clampPosition = function (pos, viewport, cardHeight = HEADER_H) {
    const maxX = Math.max(EDGE_MARGIN, viewport.innerWidth - CARD_WIDTH - EDGE_MARGIN);
    const maxY = Math.max(MENU_BAR_TOP, viewport.innerHeight - cardHeight - EDGE_MARGIN);
    return {
        x: clamp(pos.x, EDGE_MARGIN, maxX),
        y: clamp(pos.y, MENU_BAR_TOP, maxY)
    };
};

/**
 * Bottom-right anchor (stage/sprite side in LTR), clear of the workspace, then
 * clamped into bounds for small viewports.
 * @param {object} viewport - {innerWidth, innerHeight} of the window
 * @returns {object} - the default {x, y} position, clamped into bounds
 */
export const defaultPosition = function (viewport) {
    return clampPosition({
        x: viewport.innerWidth - CARD_WIDTH - EDGE_MARGIN,
        y: viewport.innerHeight - DEFAULT_CARD_H - EDGE_MARGIN
    }, viewport, DEFAULT_CARD_H);
};
