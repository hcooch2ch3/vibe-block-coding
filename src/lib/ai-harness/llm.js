/**
 * AI 하니스 — BYOK LLM 호출.
 *
 * 브라우저에서 사용자의 키로 Anthropic Messages API 를 직접 부른다(BYOK). LLM 은
 * 아이의 자연어를 미니 DSL(dsl.js 참고)로 바꿔 돌려주고, 그 DSL 이 compile/diff 를
 * 거쳐 블록이 된다. 생성(자연어→DSL)과 편집(현재 DSL + 지시→새 DSL)이 같은 경로다.
 *
 *   buildSystemPrompt / buildUserPrompt : 프롬프트 조립 (순수)
 *   parseDSL                            : 모델 텍스트에서 DSL 추출·검증 (순수)
 *   requestScripts                      : fetch 로 호출 (fetch 주입 가능 → 테스트)
 *
 * 브라우저 직접 호출이라 `anthropic-dangerous-direct-browser-access` 헤더가 필요하고,
 * 키는 로컬(사용자 소유)에 머문다. 기본 모델은 비용 민감한 아동 도구라 Haiku 4.5.
 */

import {OPMAP} from './dsl';
import {scriptFingerprint} from './edit';

export const DEFAULT_MODEL = 'claude-haiku-4-5';
export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
export const REQUEST_TIMEOUT_MS = 45000;

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
                    reject(new Error('LLM 호출 시간 초과'));
                }, timeoutMs);
            })
        ]);
    } finally {
        clearTimeout(timer);
    }
};

/**
 * 지원 DSL 어휘를 OPMAP 에서 뽑아 모델에게 규칙을 설명하는 시스템 프롬프트.
 * @returns {string} 시스템 프롬프트
 */
export const buildSystemPrompt = function () {
    const lines = Object.entries(OPMAP).map(([name, spec]) => {
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
        'A "forever" must be the LAST step in its list — nothing can follow it.',
        '',
        'Reply with ONLY a JSON array of scripts. Each script is',
        '{"hat": "<hat step>", "body": [["step", ...args], ...]}.',
        'Use only the steps above. No prose, no explanations, no code fences.'
    ].join('\n');
};

/**
 * 사용자 프롬프트 조립. currentScripts 가 있으면 편집(현재 프로그램 동봉), 없으면 생성.
 * Optional history is prepended as recent conversation context (text only, no block payloads).
 * @param {object} opts - object with instruction string, optional currentScripts array, and optional history array
 * @param {Array} [opts.history] - recent turns oldest first, each with role and text fields
 * @returns {string} 사용자 메시지 본문
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
 * `find` token so the model can COPY it into a modify/remove edit (rather than
 * derive it — no format ambiguity). Empty program → create wording.
 * @param {object} opts - {instruction, currentScripts?, history?}
 * @returns {string} 사용자 메시지 본문
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

// 코드펜스/산문에 섞인 응답에서 첫 JSON 값(배열 또는 객체) 문자열만 잘라낸다.
const sliceJSON = function (text) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const src = fenced ? fenced[1] : text;
    const start = src.search(/[[{]/);
    if (start === -1) throw new Error('LLM 응답에서 JSON 을 찾지 못함');
    const close = src[start] === '[' ? ']' : '}';
    const end = src.lastIndexOf(close);
    if (end < start) throw new Error('LLM 응답의 JSON 이 닫히지 않음');
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
        if (!Array.isArray(step)) throw new Error('스텝은 배열이어야 합니다');
        const [op, ...args] = step;
        const spec = OPMAP[op];
        if (!spec) throw new Error(`미지원 opcode: ${op}`);
        // 값 인자(하위 스택 앞)는 숫자/문자만 — 배열/객체가 NUM/TEXT 필드로 새는 것 방지.
        args.slice(0, spec.inputs.length).forEach(a => {
            if (typeof a !== 'number' && typeof a !== 'string') {
                throw new Error(`${op}: 값 인자는 숫자나 문자여야 합니다`);
            }
        });
        if (spec.substack) {
            const sub = args[spec.inputs.length];
            if (args.length !== spec.inputs.length + 1 || !Array.isArray(sub)) {
                throw new Error(`${op}: 하위 스택 배열(마지막 인자)이 필요합니다`);
            }
            if (spec.cap && !isLast) {
                throw new Error(`${op} 뒤에는 스텝을 둘 수 없습니다 (cap 블록)`);
            }
            sub.forEach((s, i) => validate(s, i === sub.length - 1));
        } else if (args.length !== spec.inputs.length) {
            throw new Error(`${op}: 인자 ${spec.inputs.length}개 필요, ${args.length}개 받음`);
        }
    };
    scripts.forEach(script => {
        const hatSpec = script && OPMAP[script.hat];
        if (!hatSpec || !hatSpec.hat) {
            throw new Error(`미지원 hat: ${script && script.hat}`);
        }
        const body = script.body || [];
        if (!Array.isArray(body)) throw new Error('body 는 배열이어야 합니다');
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
                        // Unescaped closing quote — string ended. If we were at depth 1,
                        // test from the string's opening '"' for a top-level "answer" key.
                        if (depth === 1) {
                            const tail = src.slice(stringStart);
                            const m = tail.match(answerKeyRe);
                            if (m) {
                                // Found top-level "answer" — try to decode the value.
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
        'verbatim (do not invent or recompute it) — it is a safety check; if it does not',
        'match, your edit is ignored.',
        'Only include scripts that CHANGE — every script you do not mention is kept.',
        'If the child wants behavior X INSTEAD of Y, modify or remove the script doing Y —',
        'do NOT just add X. To add a behavior alongside the rest, use "add".',
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
    const {apiKey, model, instruction, currentScripts, history,
        timeoutMs = REQUEST_TIMEOUT_MS} = config;
    const doFetch = fetchImpl || fetch;
    const res = await fetchWithTimeout(doFetch, ANTHROPIC_URL, {
        method: 'POST',
        headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
            'content-type': 'application/json'
        },
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
        throw new Error(`LLM 호출 실패: ${msg}`);
    }
    const data = await res.json();
    const text = (data.content || []).map(b => b.text || '').join('');
    return parseEnvelope(text);
};

/**
 * 사용자의 키로 Anthropic Messages API 를 호출해 DSL 스크립트를 얻는다.
 * @param {object} config - {apiKey, model?, instruction, currentScripts?}
 * @param {Function} fetchImpl - 주입용 fetch (생략 시 전역 fetch)
 * @returns {Promise<Array<object>>} DSL 스크립트 배열
 */
export const requestScripts = async function (config, fetchImpl) {
    const {apiKey, model, instruction, currentScripts,
        timeoutMs = REQUEST_TIMEOUT_MS} = config;
    const doFetch = fetchImpl || fetch;
    const res = await fetchWithTimeout(doFetch, ANTHROPIC_URL, {
        method: 'POST',
        headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
            'content-type': 'application/json'
        },
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
        throw new Error(`LLM 호출 실패: ${msg}`);
    }
    const data = await res.json();
    const text = (data.content || []).map(block => block.text || '').join('');
    return parseDSL(text);
};
