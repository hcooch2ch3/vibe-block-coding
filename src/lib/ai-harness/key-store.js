/**
 * BYOK API key persistence in localStorage. No server, the key lives only in
 * the child's browser. Storage is injectable so the logic is unit-testable
 * without a real localStorage, and every access is guarded (private mode).
 */

export const STORAGE_KEY = 'vibe.byok.apiKey';

const defaultStorage = () =>
    (typeof window === 'undefined' ? null : window.localStorage);

/**
 * @param {object} [storage] - defaults to window.localStorage
 * @returns {string} the saved key, or '' if none / storage unavailable
 */
export const loadKey = function (storage = defaultStorage()) {
    if (!storage) return '';
    try {
        // typeof guard: distinguishes a stored string (incl. '') from absent
        // (null) and rejects non-string stubs, returns '' for anything else.
        const val = storage.getItem(STORAGE_KEY);
        return typeof val === 'string' ? val : '';
    } catch (e) {
        return '';
    }
};

/**
 * @param {string} key - API key; trimmed. A non-string or blank value clears
 *   the stored key.
 * @param {object} [storage] - defaults to window.localStorage
 * @returns {boolean} true if the key was persisted (or cleared); false if
 *   storage was unavailable or rejected the write (private mode / quota), the
 *   caller should surface a "not saved" warning rather than assume success.
 */
export const saveKey = function (key, storage = defaultStorage()) {
    if (!storage) return false;
    const trimmed = typeof key === 'string' ? key.trim() : '';
    try {
        if (trimmed) {
            storage.setItem(STORAGE_KEY, trimmed);
        } else {
            storage.removeItem(STORAGE_KEY);
        }
        return true;
    } catch (e) {
        // storage unavailable (private mode) or quota exceeded, signal caller
        return false;
    }
};

/**
 * @param {object} [storage] - defaults to window.localStorage
 * @returns {void}
 */
export const clearKey = function (storage = defaultStorage()) {
    if (!storage) return;
    try {
        storage.removeItem(STORAGE_KEY);
    } catch (e) {
        // ignore
    }
};
