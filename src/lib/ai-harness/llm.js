/**
 * AI harness: BYOK LLM calls.
 *
 * Calls the Anthropic Messages API directly from the browser with the user's key
 * (BYOK). The LLM turns the child's natural language into a mini DSL (see dsl.js),
 * and that DSL goes through compile/diff to become blocks. Generation
 * (natural language→DSL) and editing (current DSL + instruction→new DSL) share
 * the same path.
 *
 *   buildSystemPrompt / buildUserPrompt : assemble the prompt (pure)
 *   parseDSL                            : extract and validate DSL from model text (pure)
 *   requestScripts                      : call via fetch (fetch is injectable → testable)
 *
 * Direct browser calls need the `anthropic-dangerous-direct-browser-access`
 * header, and the key stays local (owned by the user). The default model is
 * Haiku 4.5 since this is a cost-sensitive children's tool.
 */

import {OPMAP, hatName} from './dsl';
import {scriptFingerprint} from './edit';

export const DEFAULT_MODEL = 'claude-haiku-4-5';
export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
export const REQUEST_TIMEOUT_MS = 45000;

/**
 * Per-mode request headers (pure). The three connection modes differ only by
 * which auth header rides along; the body/response contract is shared.
 *   apiKey → Anthropic direct (BYOK): x-api-key + version + browser-access
 *   bearer → custom server: Authorization: Bearer <token>
 *   neither → free proxy: content-type only (matches the proxy's CORS allow-list)
 * @param {object} [opts] - {apiKey?, bearer?}
 * @returns {object} fetch headers
 */
export const buildHeaders = function (opts = {}) {
    const {apiKey, bearer} = opts;
    const headers = {'content-type': 'application/json'};
    if (apiKey) {
        headers['x-api-key'] = apiKey;
        headers['anthropic-version'] = '2023-06-01';
        headers['anthropic-dangerous-direct-browser-access'] = 'true';
    } else if (bearer) {
        headers.Authorization = `Bearer ${bearer}`;
    }
    return headers;
};

/**
 * Extract the reply text from a v1-contract response. Canonical shape is
 * Anthropic's {content:[{text}]}; {text} and OpenAI-style
 * {choices:[{message:{content}}]} are tolerated as compatibility fallbacks so a
 * custom server can front any provider. Precedence: content → text → choices.
 * @param {object} data - parsed JSON response body
 * @returns {string} concatenated reply text ('' if no known shape)
 */
export const extractText = function (data) {
    if (data && Array.isArray(data.content)) return data.content.map(b => b.text || '').join('');
    if (data && typeof data.text === 'string') return data.text;
    if (data && Array.isArray(data.choices) && data.choices[0] && data.choices[0].message) {
        return data.choices[0].message.content || '';
    }
    return '';
};

/**
 * Wraps doFetch with a timeout that rejects the returned promise after
 * timeoutMs milliseconds. When the browser's AbortController is available
 * (window.AbortController), the in-flight fetch is also aborted so the
 * connection is torn down; in environments where AbortController is absent
 * (Jest 21 + jsdom) the fetch continues in the background but the caller
 * receives the timeout rejection and can proceed. clearTimeout fires in the
 * finally block on every path to prevent timer leaks.
 * @param {Function} doFetch - fetch implementation (real or injected)
 * @param {string} url - request URL
 * @param {object} options - fetch options (signal added when AbortController is available)
 * @param {number} timeoutMs - milliseconds before the timeout rejection fires
 * @returns {Promise<Response>} the fetch response
 */
const fetchWithTimeout = async function (doFetch, url, options, timeoutMs) {
    // AbortController is a browser global. Jest 21 + jsdom omits it from the
    // sandbox window, so feature-detect via window rather than a bare reference.
    const Ctor = (typeof window !== 'undefined' && window.AbortController) || null;
    const controller = Ctor ? new Ctor() : null;
    const opts = controller ?
        Object.assign({}, options, {signal: controller.signal}) :
        options;
    let timer;
    try {
        return await Promise.race([
            doFetch(url, opts),
            new Promise((resolve, reject) => {
                timer = setTimeout(() => {
                    if (controller) controller.abort();
                    reject(new Error('LLM call timed out'));
                }, timeoutMs);
            })
        ]);
    } finally {
        clearTimeout(timer);
    }
};

/**
 * System prompt that pulls the supported DSL vocabulary from OPMAP and explains
 * the rules to the model.
 * @returns {string} system prompt
 */
export const buildSystemPrompt = function () {
    // Field hats (a dropdown on the block body, e.g. when_key) can't be rendered by the
    // generic value-input loop; skip any spec with `fields` and advertise them explicitly below.
    const lines = Object.entries(OPMAP)
        .filter(([, spec]) => !spec.fields)
        .map(([name, spec]) => {
            const args = spec.inputs.map(inp => inp.name).join(', ');
            const kind = spec.hat ? ' (hat: starts a script)' : '';
            const head = args ? `${name}(${args})` : name;
            return spec.substack ? `- ${head} { ...steps }${kind}` : `- ${head}${kind}`;
        });
    return [
        'You turn a child\'s request into Scratch blocks, written as a tiny JSON DSL.',
        'Supported steps:',
        ...lines,
        '',
        'Loops take a nested array of steps as their LAST element:',
        '  ["repeat", 10, [["move", 10], ["turn", 15]]]',
        '  ["forever", [["move", 10]]]',
        'A "forever" must be the LAST step in its list. Nothing can follow it.',
        '',
        'To start a script when a key is pressed, use an ARRAY hat with the key:',
        '  {"hat": ["when_key", "space"], "body": [["move", 10]]}',
        'Allowed keys: space, up arrow, down arrow, left arrow, right arrow, any.',
        '',
        'Reply with ONLY a JSON array of scripts. Each script is',
        '{"hat": "<hat step>", "body": [["step", ...args], ...]}.',
        'Use only the steps above. No prose, no explanations, no code fences.'
    ].join('\n');
};

/**
 * Assemble the user prompt. With currentScripts it edits (embeds the current
 * program), without it generates.
 * Optional history is prepended as recent conversation context (text only, no block payloads).
 * @param {object} opts - object with instruction string, optional currentScripts array, and optional history array
 * @param {Array} [opts.history] - recent turns oldest first, each with role and text fields
 * @returns {string} user message body
 */
export const buildUserPrompt = function (opts) {
    const {instruction, currentScripts, history} = opts;

    // Prepend recent conversation history as inline context (text only, no DSL payloads).
    const historyLines = (history && history.length) ?
        [
            'Recent conversation:',
            ...history.map(turn => `${turn.role === 'ai' ? 'AI' : 'User'}: ${turn.text}`),
            ''
        ] :
        [];

    if (currentScripts && currentScripts.length) {
        return [
            ...historyLines,
            'Current program (JSON DSL):',
            JSON.stringify(currentScripts),
            '',
            `Edit it so that: ${instruction}`,
            'Return the FULL updated program; keep unchanged scripts identical.'
        ].join('\n');
    }
    return [...historyLines, `Create a program so that: ${instruction}`].join('\n');
};

// Recent conversation as inline text context (no DSL payloads). Shared by the
// envelope turn prompt.
const historyPreamble = function (history) {
    if (!history || !history.length) return [];
    return ['Recent conversation:', ...history.map(t => `${t.role === 'ai' ? 'AI' : 'User'}: ${t.text}`), ''];
};

/**
 * Envelope turn prompt. Numbers the current program and prints each script's
 * `find` token so the model can COPY it into a modify/remove edit instead of
 * deriving it (no format ambiguity). Empty program → create wording.
 * @param {object} opts - {instruction, currentScripts?, history?}
 * @returns {string} user message body
 */
export const buildTurnUserPrompt = function (opts) {
    const {instruction, currentScripts, history} = opts;
    const pre = historyPreamble(history);
    if (currentScripts && currentScripts.length) {
        const numbered = currentScripts.map((s, i) =>
            `#${i + 1} (find: ${scriptFingerprint(s)}) ${JSON.stringify(s)}`);
        return [
            ...pre,
            'Current program (each script shows its id and find token):',
            ...numbered,
            '',
            `The child says: ${instruction}`,
            'Return ONLY the scripts that must change, as edits. Scripts you do not',
            'mention stay exactly as they are.'
        ].join('\n');
    }
    return [...pre, `The program is empty. Create it so that: ${instruction}`].join('\n');
};

// Slice out just the first JSON value (array or object) from a reply that may be
// mixed with code fences or prose.
const sliceJSON = function (text) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const src = fenced ? fenced[1] : text;
    const start = src.search(/[[{]/);
    if (start === -1) throw new Error('no JSON found in the LLM response');
    const close = src[start] === '[' ? ']' : '}';
    const end = src.lastIndexOf(close);
    if (end < start) throw new Error('the JSON in the LLM response is not closed');
    return src.slice(start, end + 1);
};

/**
 * Validate an array of DSL scripts against OPMAP. Throws on the first
 * structural or vocabulary error. Returns the same scripts array on success.
 * Extracted from parseDSL so parseEnvelope can share the same validation path.
 * @param {Array<object>} scripts - [{hat, body}, ...]
 * @returns {Array<object>} the same scripts array (validated)
 */
export const validateScripts = function (scripts) {
    const validateStep = function validate (step, isLast) {
        if (!Array.isArray(step)) throw new Error('step must be an array');
        const [op, ...args] = step;
        const spec = OPMAP[op];
        if (!spec) throw new Error(`unsupported opcode: ${op}`);
        // Value args (before the substack) must be number/string only, to keep
        // arrays/objects from leaking into NUM/TEXT fields.
        args.slice(0, spec.inputs.length).forEach(a => {
            if (typeof a !== 'number' && typeof a !== 'string') {
                throw new Error(`${op}: value args must be a number or string`);
            }
        });
        if (spec.substack) {
            const sub = args[spec.inputs.length];
            if (args.length !== spec.inputs.length + 1 || !Array.isArray(sub)) {
                throw new Error(`${op}: a substack array (last arg) is required`);
            }
            if (spec.cap && !isLast) {
                throw new Error(`${op}: no steps allowed after a cap block`);
            }
            sub.forEach((s, i) => validate(s, i === sub.length - 1));
        } else if (args.length !== spec.inputs.length) {
            throw new Error(`${op}: expected ${spec.inputs.length} args, got ${args.length}`);
        }
    };
    scripts.forEach(script => {
        const hn = script && hatName(script.hat);
        const hatSpec = hn && OPMAP[hn];
        if (!hatSpec || !hatSpec.hat) {
            throw new Error(`unsupported hat: ${script && JSON.stringify(script.hat)}`);
        }
        // Hat dropdown fields: an array hat carries [name, ...fieldValues]. A fieldless
        // hat is normally a bare string (the array form ['when_flag'] with no field args is
        // tolerated and canonicalizes to the string on round-trip); a field hat must supply
        // exactly its fields, all in-enum.
        const hatFields = hatSpec.fields || [];
        const hatArgs = Array.isArray(script.hat) ? script.hat.slice(1) : [];
        if (hatArgs.length !== hatFields.length) {
            throw new Error(`hat ${hn}: expected ${hatFields.length} field arg(s), got ${hatArgs.length}`);
        }
        hatFields.forEach((f, i) => {
            if (!(f.values || []).includes(hatArgs[i])) {
                throw new Error(`hat ${hn}: invalid ${f.name}: ${hatArgs[i]}`);
            }
        });
        const body = script.body || [];
        if (!Array.isArray(body)) throw new Error('body must be an array');
        body.forEach((step, i) => validateStep(step, i === body.length - 1));
    });
    return scripts;
};

/**
 * Extract and validate DSL scripts from raw model text.
 * @param {string} text - raw model reply
 * @returns {Array<object>} {hat, body} DSL script array
 */
export const parseDSL = function (text) {
    const parsed = JSON.parse(sliceJSON(text));
    return validateScripts(Array.isArray(parsed) ? parsed : [parsed]);
};

/**
 * Parse the unified-chat envelope. `answer` is free text; `edits` (optional) is
 * an array of {action, id?, find?, script?} validated structurally per-edit.
 * Independent-field fail-closed: an invalid or empty edits array is dropped
 * WITHOUT discarding a valid answer.
 *
 * Handles the max_tokens truncation path: a reply cut mid-JSON that still has
 * a complete leading "answer" field will have the answer salvaged and edits
 * dropped, rather than throwing.
 *
 * @param {string} text - raw model reply
 * @returns {object} object with optional answer string and optional validated edits array
 */
export const parseEnvelope = function (text) {
    let obj;
    try {
        obj = JSON.parse(sliceJSON(text));
    } catch (e) {
        // Truncated mid-JSON (the max_tokens path): the whole object won't parse,
        // but a complete leading "answer" field usually survives. Salvage it and
        // drop blocks. If not even an answer is present, rethrow so the caller
        // shows the retry nudge.
        // Safety: only accept an "answer" that sits at depth 1 of the outer object
        // (a direct child key). A bare regex can fire on "answer" nested inside
        // blocks; instead we scan character-by-character, tracking JSON string and
        // brace/bracket depth, and only attempt salvage when depth === 1.
        const salvaged = (function scanForTopLevelAnswer () {
            const src = text;
            // Find the outer object's opening '{'.
            const outerStart = src.search(/\{/);
            if (outerStart === -1) return null;
            let depth = 0;
            let inString = false;
            let escaped = false;
            let stringStart = -1; // index of the opening '"' of the current string
            // Matches a candidate "answer":"..." starting right at the opening '"'
            // of the key name. Reuses the same value-capture group as before.
            const answerKeyRe = /^"answer"\s*:\s*"((?:[^"\\]|\\.)*)"/;
            for (let i = outerStart; i < src.length; i++) {
                const ch = src[i];
                if (inString) {
                    if (escaped) {
                        escaped = false;
                    } else if (ch === '\\') {
                        escaped = true;
                    } else if (ch === '"') {
                        // Unescaped closing quote, so the string ended. If we were at
                        // depth 1, test from the string's opening '"' for a top-level "answer" key.
                        if (depth === 1) {
                            const tail = src.slice(stringStart);
                            const m = tail.match(answerKeyRe);
                            if (m) {
                                // Found the top-level "answer". Try to decode the value.
                                try {
                                    return JSON.parse(`"${m[1]}"`);
                                } catch (e2) {
                                    return null; // mis-decode → fall through → rethrow
                                }
                            }
                        }
                        inString = false;
                        stringStart = -1;
                    }
                } else if (ch === '"') {
                    inString = true;
                    escaped = false;
                    stringStart = i;
                } else if (ch === '{' || ch === '[') {
                    depth++;
                } else if (ch === '}' || ch === ']') {
                    depth--;
                }
            }
            return null;
        }());
        if (salvaged !== null) return {answer: salvaged};
        throw e;
    }
    const out = {};
    // Structural validation per edit (independent fail-closed). Range/fingerprint
    // matching happens later in editsToOps, which knows the current program.
    const validateEdits = function (list) {
        const kept = [];
        for (const e of list) {
            if (!e || typeof e !== 'object') continue;
            if (e.action === 'add') {
                if (!e.script) continue;
                try {
                    validateScripts([e.script]);
                } catch (err) {
                    continue;
                }
                kept.push({action: 'add', script: e.script});
            } else if (e.action === 'modify') {
                if (!e.script || !(Number.isInteger(e.id) && e.id >= 1) || typeof e.find !== 'string') continue;
                try {
                    validateScripts([e.script]);
                } catch (err) {
                    continue;
                }
                kept.push({action: 'modify', id: e.id, find: e.find, script: e.script});
            } else if (e.action === 'remove') {
                if (!(Number.isInteger(e.id) && e.id >= 1) || typeof e.find !== 'string') continue;
                kept.push({action: 'remove', id: e.id, find: e.find});
            }
        }
        return kept;
    };
    // Bare-array regression (model emits [{hat,body},...]) → all-adds. NOTE: with
    // keep-by-omission this duplicates the program if the model resends everything;
    // rare fallback, surfaced by the eval (measureEditQuality).
    if (Array.isArray(obj)) {
        const kept = validateEdits(obj.map(s => ({action: 'add', script: s})));
        if (kept.length) out.edits = kept;
        return out;
    }
    if (obj && typeof obj.answer === 'string' && obj.answer.trim()) out.answer = obj.answer;
    if (obj && Array.isArray(obj.edits) && obj.edits.length) {
        const kept = validateEdits(obj.edits);
        if (kept.length) out.edits = kept;
    }
    return out;
};

export const ENVELOPE_MAX_TOKENS = 2048;

// Envelope-mode system prompt: same DSL vocabulary as buildSystemPrompt, but the
// model returns {answer, edits} instead of a bare array. Kept SEPARATE so the
// legacy requestScripts/parseDSL path (Task 0 measure, window.vibe.smoke) still
// gets an array and does not break.
export const buildEnvelopeSystemPrompt = function () {
    const vocab = buildSystemPrompt()
        .split('\n')
        .filter(l => !l.startsWith('Reply with ONLY') &&
            !l.startsWith('{"hat"') &&
            !l.startsWith('Use only the steps'));
    return [
        ...vocab,
        '',
        'If the child is ASKING a question, reply {"answer": "<short friendly reply>"} with no edits.',
        'If the child wants to MAKE or CHANGE something, reply',
        '{"answer": "<one short line explaining what you did>", "edits": [<edits>]}.',
        'Each edit is ONE of:',
        '  {"action": "add", "script": {"hat": "<hat>", "body": [["step", ...], ...]}}',
        '  {"action": "modify", "id": <id>, "find": "<find token of #id>", "script": {...}}',
        '  {"action": "remove", "id": <id>, "find": "<find token of #id>"}',
        'For modify/remove, COPY the find token printed next to script #id in the list',
        'verbatim (do not invent or recompute it). It is a safety check; if it does not',
        'match, your edit is ignored.',
        'Only include scripts that CHANGE. Every script you do not mention is kept.',
        'If the child wants behavior X INSTEAD of Y, modify or remove the script doing Y.',
        'Do NOT just add X. To add a behavior alongside the rest, use "add".',
        'No prose outside the JSON, no code fences.'
    ].join('\n');
};

/**
 * Envelope-mode turn: calls the Anthropic Messages API and returns a parsed
 * {answer?, edits?} envelope. Uses buildEnvelopeSystemPrompt so the model
 * emits structured JSON rather than a bare DSL array. Supports optional history
 * context passed through to buildTurnUserPrompt.
 * @param {object} config - object with apiKey, instruction, and optional model, currentScripts, history
 * @param {Function} [fetchImpl] - injectable fetch (omit to use global fetch)
 * @returns {Promise<object>} parsed envelope with optional answer string and optional edits array
 */
export const requestTurn = async function (config, fetchImpl) {
    const {apiKey, model, instruction, currentScripts, history, endpoint, headers,
        timeoutMs = REQUEST_TIMEOUT_MS} = config;
    const doFetch = fetchImpl || fetch;
    const res = await fetchWithTimeout(doFetch, endpoint || ANTHROPIC_URL, {
        method: 'POST',
        headers: headers || buildHeaders({apiKey}),
        body: JSON.stringify({
            model: model || DEFAULT_MODEL,
            max_tokens: ENVELOPE_MAX_TOKENS,
            system: buildEnvelopeSystemPrompt(),
            messages: [{role: 'user', content: buildTurnUserPrompt({instruction, currentScripts, history})}]
        })
    }, timeoutMs);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg = (err.error && err.error.message) || `HTTP ${res.status}`;
        throw new Error(`LLM call failed: ${msg}`);
    }
    const data = await res.json();
    return parseEnvelope(extractText(data));
};

/**
 * Call the Anthropic Messages API with the user's key to get DSL scripts.
 * @param {object} config - {apiKey, model?, instruction, currentScripts?}
 * @param {Function} fetchImpl - injectable fetch (omit to use global fetch)
 * @returns {Promise<Array<object>>} DSL script array
 */
export const requestScripts = async function (config, fetchImpl) {
    const {apiKey, model, instruction, currentScripts, endpoint, headers,
        timeoutMs = REQUEST_TIMEOUT_MS} = config;
    const doFetch = fetchImpl || fetch;
    const res = await fetchWithTimeout(doFetch, endpoint || ANTHROPIC_URL, {
        method: 'POST',
        headers: headers || buildHeaders({apiKey}),
        body: JSON.stringify({
            model: model || DEFAULT_MODEL,
            max_tokens: 1024,
            system: buildSystemPrompt(),
            messages: [{role: 'user', content: buildUserPrompt({instruction, currentScripts})}]
        })
    }, timeoutMs);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg = (err.error && err.error.message) || `HTTP ${res.status}`;
        throw new Error(`LLM call failed: ${msg}`);
    }
    const data = await res.json();
    return parseDSL(extractText(data));
};
