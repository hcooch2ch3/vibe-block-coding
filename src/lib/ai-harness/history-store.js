/**
 * Chat-history persistence in localStorage. Mirrors key-store.js / ui-prefs.js:
 * storage is injectable and every access is guarded, so the card still works
 * (just won't remember history) when storage is unavailable.
 */

export const STORAGE_KEY = 'vibe.history';
export const MAX_ENTRIES = 30;

const defaultStorage = () =>
    (typeof window === 'undefined' ? null : window.localStorage);

/**
 * @param {object} [storage] - defaults to window.localStorage
 * @returns {Array} - the saved entries, or [] if absent/malformed/unavailable
 */
export const loadHistory = function (storage = defaultStorage()) {
    if (!storage) return [];
    try {
        const raw = storage.getItem(STORAGE_KEY);
        if (typeof raw !== 'string') return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
};

/**
 * @param {Array} entries - history entries; trimmed to the last MAX_ENTRIES
 * @param {object} [storage] - defaults to window.localStorage
 * @returns {boolean} - true if persisted; false if storage rejected the write
 */
export const saveHistory = function (entries, storage = defaultStorage()) {
    if (!storage) return false;
    const trimmed = entries.slice(-MAX_ENTRIES);
    try {
        storage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
        return true;
    } catch (e) {
        return false;
    }
};
