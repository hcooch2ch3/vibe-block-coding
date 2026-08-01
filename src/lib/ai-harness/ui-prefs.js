/**
 * Floating-card UI preferences (position + collapsed) persisted in localStorage.
 * Mirrors key-store.js: storage is injectable and every access is guarded so the
 * card still works (just won't remember its spot) when storage is unavailable.
 */

export const STORAGE_KEY = 'vibe.ui.prefs';

export const DEFAULT_CONTEXT_TURNS = 3;
export const MAX_CONTEXT_TURNS = 10;

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
// Resizable-card bounds. Default width matches CARD_WIDTH; height defaults to
// null (content-driven) until the child drags the resize handle.
export const MIN_W = 240;
export const MIN_H = 160;
export const DEFAULT_W = CARD_WIDTH;

const defaultStorage = () =>
    (typeof window === 'undefined' ? null : window.localStorage);

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/**
 * @param {object} [storage] - defaults to window.localStorage
 * @returns {?object} parsed prefs object with {x:number, y:number,
 *   collapsed:boolean, w:?number, h:?number, contextTurns:number}, or null if
 *   absent / storage unavailable / malformed.
 */
export const loadPrefs = function (storage = defaultStorage()) {
    if (!storage) return null;
    try {
        const raw = storage.getItem(STORAGE_KEY);
        if (typeof raw !== 'string') return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null;
        return {
            x: parsed.x,
            y: parsed.y,
            collapsed: Boolean(parsed.collapsed),
            // size is optional — width defaults on load, height stays content-driven
            // (null) until the child has resized. Only accept finite stored values.
            w: Number.isFinite(parsed.w) ? parsed.w : null,
            h: Number.isFinite(parsed.h) ? parsed.h : null,
            contextTurns: clamp(
                Math.round(Number.isFinite(parsed.contextTurns) ? parsed.contextTurns : DEFAULT_CONTEXT_TURNS),
                0,
                MAX_CONTEXT_TURNS
            )
        };
    } catch (e) {
        return null;
    }
};

/**
 * @param {object} prefs - the prefs to persist ({x, y, collapsed, w, h, contextTurns})
 * @param {object} [storage] - defaults to window.localStorage
 * @returns {boolean} - true if persisted; false if storage rejected the write
 */
export const savePrefs = function (prefs, storage = defaultStorage()) {
    if (!storage) return false;
    try {
        const out = {
            x: prefs.x,
            y: prefs.y,
            collapsed: Boolean(prefs.collapsed)
        };
        if (Number.isFinite(prefs.w)) out.w = prefs.w;
        if (Number.isFinite(prefs.h)) out.h = prefs.h;
        if (Number.isFinite(prefs.contextTurns)) {
            out.contextTurns = clamp(Math.round(prefs.contextTurns), 0, MAX_CONTEXT_TURNS);
        }
        storage.setItem(STORAGE_KEY, JSON.stringify(out));
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

/**
 * Clamp a resize to sane bounds: at least MIN_W x MIN_H, at most the viewport
 * minus margins (so the card can't be resized larger than the screen).
 * @param {object} size - the candidate {w, h}
 * @param {object} viewport - {innerWidth, innerHeight} of the window
 * @returns {object} - the clamped {w, h}
 */
export const clampSize = function (size, viewport) {
    const maxW = Math.max(MIN_W, viewport.innerWidth - (2 * EDGE_MARGIN));
    const maxH = Math.max(MIN_H, viewport.innerHeight - MENU_BAR_TOP - EDGE_MARGIN);
    return {
        w: clamp(size.w, MIN_W, maxW),
        h: clamp(size.h, MIN_H, maxH)
    };
};
