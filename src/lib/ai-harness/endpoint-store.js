/**
 * Connection-mode persistence in localStorage. Sits alongside key-store.js and
 * follows the same guarded, injectable-storage pattern.
 *
 * Three modes share ONE client request path (see llm.js):
 *   free   → POST PROXY_URL, no auth header (the key lives on the proxy server)
 *   key    → POST api.anthropic.com directly with the child's own x-api-key
 *   server → POST a user-typed URL, optional Authorization: Bearer <token>
 *
 * Only mode + serverUrl + serverToken live here; the BYOK key stays in
 * key-store.js so the existing BYOK flow is untouched.
 */

// The deployed proxy endpoint (v1 contract). Not a secret. Baked at build time.
// RUNBOOK: replace the default with your Vercel function URL before `npm run
// deploy`. The process.env read is a convenience for local overrides only and is
// guarded so a static browser bundle without the define never throws.
const envProxyUrl =
    (typeof process !== 'undefined' && process.env && process.env.VIBE_PROXY_URL) || '';
export const PROXY_URL = envProxyUrl || 'https://YOUR-PROXY.vercel.app/api/chat';

// Loud signal if the demo shipped without a real proxy URL — free mode would
// otherwise POST to a nonexistent host and fail silently for every visitor.
if (PROXY_URL.indexOf('YOUR-PROXY') !== -1 && typeof console !== 'undefined' && console.warn) {
    // eslint-disable-next-line no-console
    console.warn(
        '[vibe] PROXY_URL is still the placeholder — free mode will not work. ' +
        'Set VIBE_PROXY_URL at build time or edit PROXY_URL in endpoint-store.js.'
    );
}

export const STORAGE_KEY = 'vibe.endpoint';
export const MODES = ['free', 'key', 'server'];

const defaultStorage = () =>
    (typeof window === 'undefined' ? null : window.localStorage);

const isMode = m => MODES.indexOf(m) !== -1;

/**
 * @param {object} [storage] - defaults to window.localStorage
 * @returns {{mode: string, serverUrl: string, serverToken: string}} saved
 *   settings, or defaults ({mode:'free', serverUrl:'', serverToken:''}) if none
 *   / storage unavailable / stored value is corrupt.
 */
export const loadEndpoint = function (storage = defaultStorage()) {
    const fallback = {mode: 'free', serverUrl: '', serverToken: ''};
    if (!storage) return fallback;
    try {
        const raw = storage.getItem(STORAGE_KEY);
        if (typeof raw !== 'string' || !raw) return fallback;
        const val = JSON.parse(raw);
        if (!val || typeof val !== 'object') return fallback;
        return {
            mode: isMode(val.mode) ? val.mode : 'free',
            serverUrl: typeof val.serverUrl === 'string' ? val.serverUrl : '',
            serverToken: typeof val.serverToken === 'string' ? val.serverToken : ''
        };
    } catch (e) {
        return fallback;
    }
};

/**
 * @param {object} settings - {mode, serverUrl?, serverToken?}. mode is validated;
 *   an unknown mode is coerced to 'free'. Strings are trimmed.
 * @param {object} [storage] - defaults to window.localStorage
 * @returns {boolean} true if persisted; false if storage was unavailable /
 *   rejected the write (private mode / quota) — caller should warn rather than
 *   assume success.
 */
export const saveEndpoint = function (settings, storage = defaultStorage()) {
    if (!storage) return false;
    const s = settings || {};
    const out = {
        mode: isMode(s.mode) ? s.mode : 'free',
        serverUrl: typeof s.serverUrl === 'string' ? s.serverUrl.trim() : '',
        serverToken: typeof s.serverToken === 'string' ? s.serverToken.trim() : ''
    };
    try {
        storage.setItem(STORAGE_KEY, JSON.stringify(out));
        return true;
    } catch (e) {
        return false;
    }
};
