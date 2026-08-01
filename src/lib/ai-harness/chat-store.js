/**
 * Chat transcript persistence in localStorage. Mirrors history-store.js / ui-prefs.js:
 * storage is injectable and every access is guarded so the UI still works
 * (just won't remember the transcript) when storage is unavailable.
 *
 * Turn shapes per spec §2:
 *   {id, role:'user', text}
 *   {id, role:'ai', kind:'answer', text, instruction, targetId}
 *   {id, role:'ai', kind:'proposal', text, instruction, targetId, preview, baseStamp, status}
 */

export const STORAGE_KEY = 'vibe.chat.v2';
export const MAX_TURNS = 60;

const defaultStorage = () =>
    (typeof window === 'undefined' ? null : window.localStorage);

const isValidTurn = t => t && (t.role === 'user' || t.role === 'ai');

// Terminal proposal turns (applied/ignored) no longer need their preview payload or
// baseStamp; strip them before persist to bound the vibe.chat.v2 blob. pending/stale
// keep them so a reload can still render and Apply the card.
const stripVolatile = function (turn) {
    if (turn.kind === 'proposal' && (turn.status === 'applied' || turn.status === 'ignored')) {
        const copy = Object.assign({}, turn);
        delete copy.preview;
        delete copy.baseStamp;
        return copy;
    }
    return turn;
};

/**
 * @param {object} [storage] - defaults to window.localStorage
 * @returns {Array} the saved turns, or [] if absent/malformed/unavailable
 */
export const loadChat = function (storage = defaultStorage()) {
    if (!storage) return [];
    try {
        const parsed = JSON.parse(storage.getItem(STORAGE_KEY));
        return Array.isArray(parsed) ? parsed.filter(isValidTurn) : [];
    } catch (e) {
        return [];
    }
};

/**
 * @param {Array} turns - chat turns; trimmed to the last MAX_TURNS and
 *   volatile fields stripped from terminal proposal turns before persist
 * @param {object} [storage] - defaults to window.localStorage
 * @returns {boolean} true if persisted; false if storage rejected the write
 */
export const saveChat = function (turns, storage = defaultStorage()) {
    if (!storage) return false;
    try {
        storage.setItem(STORAGE_KEY, JSON.stringify(turns.slice(-MAX_TURNS).map(stripVolatile)));
        return true;
    } catch (e) {
        return false;
    }
};
