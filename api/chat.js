/**
 * Free-demo proxy (Vercel serverless, CommonJS, zero npm deps — fetch only).
 *
 * Holds the Anthropic key server-side (env ANTHROPIC_API_KEY) so the public demo
 * runs without every child pasting their own key. The browser posts the v1
 * contract body ({system, messages, max_tokens}); this function forces the cheap
 * model, clamps the token cap, guards input size, checks the app marker, applies
 * daily + per-IP limits, then forwards to the Messages API with the key attached.
 *
 * SECURITY MODEL (deliberately layered; only the last one is a hard wall):
 *   1. Anthropic MONTHLY SPEND CAP (set low in the console) — the real ceiling.
 *      Everything below is deterrence/spreading, not a boundary. VERIFY it
 *      hard-stops before going public (set a $1 cap, hammer it, confirm it 4xxs).
 *   2. DAILY total cap (Upstash, date-keyed) — stops one day from draining the
 *      month; a drained demo recovers the next day. This is what prevents
 *      "one user burns the whole month in a day".
 *   3. Per-IP minute limit (Upstash, Vercel-trusted IP) — stops one person
 *      hogging a day's budget. Spoofable in theory; the daily cap backstops it.
 *   4. Per-call clamps — forced Haiku, max_tokens <= 2048, input <= 16000 chars.
 *   5. App-marker check — the request's system prompt must look like ours, so
 *      the key can't be trivially used as general-purpose Claude. Deterrence
 *      against lazy abuse only (the marker is a public phrase).
 * KV checks FAIL OPEN: an Upstash outage falls back to layers 1+4 (bounded by
 * the monthly cap), rather than taking the demo down on a KV blip.
 * CORS is NOT an abuse control (it protects browsers, not the wallet).
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const FORCED_MODEL = 'claude-haiku-4-5';
const MAX_TOKENS_CAP = 2048;
const MAX_INPUT_CHARS = 16000;
// KEEP IN SYNC with buildEnvelopeSystemPrompt()/buildSystemPrompt() in
// src/lib/ai-harness/llm.js. A unit test asserts the prompt still contains this
// phrase, so a reword there trips CI instead of silently 400-ing the demo.
const APP_MARKER = 'Scratch blocks';
// Aggregate ceilings. Set DAILY_CALL_LIMIT to ~ (monthly cap / cost-per-call / 30).
const DAILY_CALL_LIMIT = Number(process.env.DAILY_CALL_LIMIT) || 2000;
const IP_PER_MIN_LIMIT = Number(process.env.IP_PER_MIN_LIMIT) || 20;

// --- Upstash Redis REST helpers (optional; skipped when env is absent) ---------
const KV_URL = process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const kvEnabled = Boolean(KV_URL && KV_TOKEN);
// Warn once per cold-started instance if the rate/daily limiter is OFF because
// the KV env vars are missing. Without KV, ONLY the per-call clamps and the
// Anthropic monthly cap bound spend — the day-spreading wall is silently gone.
let warnedNoKv = false;

// Run one Upstash REST command, e.g. kv('INCR', key). Returns the numeric result
// or null on any failure (caller decides fail-open vs fail-closed).
const kv = async function (...parts) {
    if (!kvEnabled) return null;
    try {
        const path = parts.map(encodeURIComponent).join('/');
        const r = await fetch(`${KV_URL}/${path}`, {
            headers: {Authorization: `Bearer ${KV_TOKEN}`}
        });
        if (!r.ok) return null;
        const data = await r.json();
        return typeof data.result === 'number' ? data.result : null;
    } catch (e) {
        return null;
    }
};

// Vercel-trusted client IP. x-real-ip is set by Vercel's edge (not the raw,
// client-spoofable left end of x-forwarded-for). Falls back to xff only if
// x-real-ip is absent. RUNBOOK: confirm x-real-ip is populated for this
// function's runtime before trusting the per-IP layer.
const clientIp = function (req) {
    const real = req.headers['x-real-ip'];
    if (real) return String(real).trim();
    const xff = req.headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
    return 'unknown';
};

// UTC day stamp, e.g. 20260807 — a date-keyed counter resets naturally at the
// day boundary, so we never depend on EXPIRE landing (non-atomic in REST).
const dayStamp = function () {
    const iso = new Date().toISOString();
    const ymd = iso.slice(0, 10);
    return ymd.split('-').join('');
};

module.exports = async function (req, res) {
    const origin = process.env.ALLOWED_ORIGIN || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.setHeader('Vary', 'Origin');

    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).json({error: {message: 'method not allowed'}});
        return;
    }

    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
        res.status(500).json({error: {message: 'proxy is missing ANTHROPIC_API_KEY'}});
        return;
    }

    const body = req.body || {};
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const system = typeof body.system === 'string' ? body.system : '';

    // App-marker: reject anything that isn't our block-coding prompt.
    if (!system.includes(APP_MARKER)) {
        res.status(400).json({error: {message: 'request is not a valid app request'}});
        return;
    }
    // Input-size guard.
    if (!messages.length || system.length + JSON.stringify(messages).length > MAX_INPUT_CHARS) {
        res.status(400).json({error: {message: 'request is empty or too large'}});
        return;
    }

    if (!kvEnabled && !warnedNoKv) {
        warnedNoKv = true;
        // eslint-disable-next-line no-console
        console.warn('[vibe-proxy] Upstash KV env not set — daily + per-IP limits are OFF. ' +
            'Only per-call clamps and the Anthropic monthly cap bound spend. Set ' +
            'UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN for the demo.');
    }
    // Per-IP minute limit (deterrence; fail-open on KV error). key rolls per minute.
    if (kvEnabled) {
        const minute = Math.floor(Date.now() / 60000);
        const ipKey = `rl:${clientIp(req)}:${minute}`;
        const ipCount = await kv('INCR', ipKey);
        if (ipCount === 1) await kv('EXPIRE', ipKey, '120');
        if (ipCount !== null && ipCount > IP_PER_MIN_LIMIT) {
            res.status(429).json({error: {message: 'too many requests, slow down'}});
            return;
        }
        // Daily total cap (the real spreading wall; date-keyed so reset is free).
        const dayKey = `budget:${dayStamp()}`;
        const dayCount = await kv('INCR', dayKey);
        if (dayCount === 1) await kv('EXPIRE', dayKey, '172800');
        if (dayCount !== null && dayCount > DAILY_CALL_LIMIT) {
            res.status(503).json({error: {message: 'daily demo limit reached', code: 'daily_limit'}});
            return;
        }
    }

    const n = Number(body.max_tokens);
    const maxTokens = Number.isFinite(n) && n > 0 ? Math.min(n, MAX_TOKENS_CAP) : MAX_TOKENS_CAP;

    try {
        const r = await fetch(ANTHROPIC_URL, {
            method: 'POST',
            headers: {
                'x-api-key': key,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                model: FORCED_MODEL, // force cheap model — ignore client's model
                max_tokens: maxTokens,
                system,
                messages
            })
        });
        const data = await r.json().catch(() => ({}));
        res.status(r.status).json(data);
    } catch (e) {
        res.status(502).json({error: {message: 'upstream request failed'}});
    }
};
