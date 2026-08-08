import {
    DEFAULT_MODEL,
    buildSystemPrompt,
    buildUserPrompt,
    buildTurnUserPrompt,
    buildEnvelopeSystemPrompt,
    parseDSL,
    parseEnvelope,
    requestScripts,
    requestTurn,
    buildHeaders,
    extractText,
    ENVELOPE_MAX_TOKENS,
    REQUEST_TIMEOUT_MS
} from '../../../src/lib/ai-harness/llm';

const flag = body => ({hat: 'when_flag', body});

describe('buildSystemPrompt', () => {
    test('teaches the supported DSL vocabulary and asks for JSON', () => {
        const sys = buildSystemPrompt();
        // vocabulary is derived from OPMAP, so the op names must appear
        expect(sys).toMatch(/when_flag/);
        expect(sys).toMatch(/move/);
        expect(sys).toMatch(/say/);
        // it must ask the model to answer with JSON
        expect(sys.toLowerCase()).toMatch(/json/);
    });
    test('teaches the substack (loop) syntax and the forever-last rule', () => {
        const sys = buildSystemPrompt();
        expect(sys).toMatch(/\{ \.\.\.steps \}/); // repeat/forever rendered with a body
        expect(sys).toMatch(/nested array/i);
        expect(sys).toMatch(/forever.*LAST/i);
    });
});

describe('buildUserPrompt', () => {
    test('a generate request carries just the instruction', () => {
        const p = buildUserPrompt({instruction: 'make the cat walk'});
        expect(p).toMatch(/make the cat walk/);
    });

    test('an edit request includes the current program as DSL', () => {
        const p = buildUserPrompt({
            instruction: 'say hello too',
            currentScripts: [flag([['move', 10]])]
        });
        expect(p).toMatch(/say hello too/);
        // the current program is embedded so the model edits in place
        expect(p).toMatch(/move/);
        expect(p).toContain('10');
    });
});

describe('parseDSL', () => {
    test('parses a plain JSON array of scripts', () => {
        const text = '[{"hat":"when_flag","body":[["move",10]]}]';
        expect(parseDSL(text)).toEqual([flag([['move', 10]])]);
    });

    test('extracts JSON out of a fenced code block with prose around it', () => {
        const text = 'Sure!\n```json\n[{"hat":"when_flag","body":[["say","hi"]]}]\n```\nDone.';
        expect(parseDSL(text)).toEqual([flag([['say', 'hi']])]);
    });

    test('wraps a single script object into an array', () => {
        const text = '{"hat":"when_flag","body":[["move",5]]}';
        expect(parseDSL(text)).toEqual([flag([['move', 5]])]);
    });

    test('throws on an unsupported opcode', () => {
        const text = '[{"hat":"when_flag","body":[["fly",10]]}]';
        expect(() => parseDSL(text)).toThrow(/fly/);
    });

    test('throws when there is no JSON at all', () => {
        expect(() => parseDSL('I cannot help with that.')).toThrow();
    });

    test('throws when a step omits its required args (would compile to "undefined")', () => {
        // LLMs sometimes drop args; compile would then String(undefined) a block value.
        expect(() => parseDSL('[{"hat":"when_flag","body":[["move"]]}]')).toThrow(/move/);
        expect(() => parseDSL('[{"hat":"when_flag","body":[["say"]]}]')).toThrow(/say/);
    });
});

describe('requestScripts (fetch injected)', () => {
    const okResponse = text => ({
        ok: true,
        json: async () => ({content: [{type: 'text', text}]})
    });

    test('posts to Anthropic with BYOK + browser-access headers and returns parsed scripts', async () => {
        let captured;
        const fetchImpl = async (url, opts) => {
            captured = {url, opts};
            return okResponse('[{"hat":"when_flag","body":[["move",10]]}]');
        };
        const scripts = await requestScripts(
            {apiKey: 'sk-test', instruction: 'walk'},
            fetchImpl
        );
        expect(scripts).toEqual([flag([['move', 10]])]);
        expect(captured.url).toMatch(/api\.anthropic\.com/);
        expect(captured.opts.headers['x-api-key']).toBe('sk-test');
        expect(captured.opts.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
        const body = JSON.parse(captured.opts.body);
        expect(body.model).toBe(DEFAULT_MODEL);
    });

    test('honors an explicit model override', async () => {
        let captured;
        const fetchImpl = async (url, opts) => {
            captured = {opts};
            return okResponse('[{"hat":"when_flag","body":[]}]');
        };
        await requestScripts(
            {apiKey: 'k', model: 'claude-opus-4-8', instruction: 'x'},
            fetchImpl
        );
        expect(JSON.parse(captured.opts.body).model).toBe('claude-opus-4-8');
    });

    test('throws a helpful error on an API error response', async () => {
        const fetchImpl = async () => ({
            ok: false,
            status: 401,
            json: async () => ({error: {type: 'authentication_error', message: 'invalid x-api-key'}})
        });
        let message;
        try {
            await requestScripts({apiKey: 'bad', instruction: 'x'}, fetchImpl);
        } catch (e) {
            message = e.message;
        }
        expect(message).toMatch(/invalid x-api-key/);
    });
});

describe('parseDSL substack validation', () => {
    const wrap = scripts => JSON.stringify(scripts);
    test('accepts a valid repeat substack', () => {
        const out = parseDSL(wrap([{hat: 'when_flag', body: [['repeat', 3, [['move', 10]]]]}]));
        expect(out[0].body[0]).toEqual(['repeat', 3, [['move', 10]]]);
    });
    test('rejects a substack op whose last arg is not an array', () => {
        expect(() => parseDSL(wrap([{hat: 'when_flag', body: [['repeat', 3, 5]]}]))).toThrow();
    });
    test('rejects a non-substack op given an extra array arg', () => {
        expect(() => parseDSL(wrap([{hat: 'when_flag', body: [['move', 10, [['turn', 15]]]]}]))).toThrow();
    });
    test('rejects a step after forever (cap block)', () => {
        expect(() => parseDSL(
            wrap([{hat: 'when_flag', body: [['forever', [['move', 10]]], ['say', 'hi']]}])
        )).toThrow();
    });
    test('rejects a malformed nested step', () => {
        expect(() => parseDSL(wrap([{hat: 'when_flag', body: [['repeat', 3, [['move']]]]}]))).toThrow();
    });
    test('rejects a non-hat opcode used as a script hat', () => {
        expect(() => parseDSL(wrap([{hat: 'move', body: []}]))).toThrow(/hat/);
    });
    test('rejects an array passed as a flat value arg', () => {
        expect(() => parseDSL(wrap([{hat: 'when_flag', body: [['move', [['turn', 15]]]]}]))).toThrow();
    });
    test('rejects a non-array step', () => {
        expect(() => parseDSL(wrap([{hat: 'when_flag', body: [5]}]))).toThrow();
    });
});

describe('buildTurnUserPrompt', () => {
    test('numbers current scripts with 1-based ids and prints a find token', () => {
        const p = buildTurnUserPrompt({instruction: 'walk', currentScripts: [flag([['say', 'Hi']]), flag([['turn', 15]])]});
        expect(p).toMatch(/#1/);
        expect(p).toMatch(/#2/);
        expect(p).toMatch(/find:/);
        expect(p).toMatch(/walk/);
    });
    test('empty program asks to create', () => {
        expect(buildTurnUserPrompt({instruction: 'jump', currentScripts: []})).toMatch(/jump/);
    });
    test('inlines recent history text, not block payloads', () => {
        const p = buildTurnUserPrompt({instruction: 'x', currentScripts: [], history: [
            {role: 'user', text: 'walk'}, {role: 'ai', text: 'Added a move block'}
        ]});
        expect(p).toContain('walk');
        expect(p).toContain('Added a move block');
    });
});

describe('parseEnvelope (edits)', () => {
    const j = o => JSON.stringify(o);
    test('answer only → no edits key', () => {
        const out = parseEnvelope('{"answer":"Use the move block!"}');
        expect(out).toEqual({answer: 'Use the move block!'});
    });
    test('answer + valid edits (add + remove with find)', () => {
        const out = parseEnvelope(j({answer: 'ok', edits: [
            {action: 'add', script: flag([['move', 10]])},
            {action: 'remove', id: 2, find: 'abc'}
        ]}));
        expect(out).toEqual({answer: 'ok', edits: [
            {action: 'add', script: flag([['move', 10]])},
            {action: 'remove', id: 2, find: 'abc'}
        ]});
    });
    test('drops a structurally invalid edit, keeps answer + valid siblings', () => {
        const out = parseEnvelope(j({answer: 'hi', edits: [
            {action: 'add', script: {hat: 'nope', body: []}},   // bad hat → dropped
            {action: 'remove', id: 1, find: 'abc'}
        ]}));
        expect(out).toEqual({answer: 'hi', edits: [{action: 'remove', id: 1, find: 'abc'}]});
    });
    test('drops modify/remove missing find (string required)', () => {
        expect(parseEnvelope(j({answer: 'x', edits: [{action: 'remove', id: 1}]}))).toEqual({answer: 'x'});
        expect(parseEnvelope(j({answer: 'x', edits: [{action: 'modify', id: 1, script: flag([['move', 5]])}]})))
            .toEqual({answer: 'x'});
    });
    test('empty edits array → no edits key', () => {
        expect(parseEnvelope(j({answer: 'hmm', edits: []}))).toEqual({answer: 'hmm'});
    });
    test('unparseable → throws (caller shows retry nudge)', () => {
        expect(() => parseEnvelope('not json at all %%%')).toThrow();
    });
    test('truncated mid-JSON keeps the leading answer, drops edits', () => {
        const out = parseEnvelope('{"answer": "I made it walk", "edits": [{"action":"add","scr');
        expect(out).toEqual({answer: 'I made it walk'});
    });
    test('truncated at a nested "}" still salvages the top-level answer (sliceJSON nested-} pin)', () => {
        // Last '}' is a nested script's close, not the outer close → unbalanced slice,
        // JSON.parse throws, salvage fires on the top-level "answer".
        const out = parseEnvelope('{"answer":"real","edits":[{"action":"add","script":{"hat":"when_flag","body":[]}');
        expect(out).toEqual({answer: 'real'});
    });
    test('does not salvage an "answer" nested inside edits (over-match guard)', () => {
        expect(() => parseEnvelope('{"edits":[{"action":"add","answer":"not a real answer"}')).toThrow();
    });
    test('empty/whitespace answer with a valid edit keeps edits, drops answer', () => {
        const out = parseEnvelope(j({answer: '   ', edits: [{action: 'add', script: flag([['move', 10]])}]}));
        expect(out.answer).toBeUndefined();
        expect(out.edits).toHaveLength(1);
    });
    test('non-string answer is ignored, edits still parsed', () => {
        const out = parseEnvelope(j({answer: 123, edits: [{action: 'add', script: flag([['move', 10]])}]}));
        expect(out.answer).toBeUndefined();
        expect(out.edits).toHaveLength(1);
    });
});

describe('requestTurn (fetch injected)', () => {
    test('buildUserPrompt inlines recent history text, not block payloads', () => {
        const p = buildUserPrompt({instruction: 'make it jump', history: [
            {role: 'user', text: 'walk'}, {role: 'ai', text: 'Added a move block'}
        ]});
        expect(p).toContain('walk');
        expect(p).toContain('Added a move block');
        expect(p).toContain('make it jump');
    });
    test('requestTurn returns the edits envelope and uses the raised token cap', async () => {
        const fetchImpl = jest.fn(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({content: [{text: JSON.stringify({answer: 'hi', edits: [
                {action: 'add', script: {hat: 'when_clicked', body: [['move', 10]]}}
            ]})}]})
        }));
        const out = await requestTurn({apiKey: 'k', instruction: 'walk'}, fetchImpl);
        expect(out.answer).toBe('hi');
        expect(out.edits).toHaveLength(1);
        const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
        expect(body.max_tokens).toBe(ENVELOPE_MAX_TOKENS);
    });
    test('REQUEST_TIMEOUT_MS is exported and is a positive number', () => {
        expect(typeof REQUEST_TIMEOUT_MS).toBe('number');
        expect(REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
    });
    test('requestTurn rejects with a timeout error when fetch never resolves (M1)', async () => {
        const hangingFetch = function () { return new Promise(function () {}); };
        let threw = false;
        try {
            await requestTurn({apiKey: 'k', instruction: 'x', timeoutMs: 5}, hangingFetch);
        } catch (e) {
            threw = true;
        }
        expect(threw).toBe(true);
    });
    test('requestScripts rejects with a timeout error when fetch never resolves (M1)', async () => {
        const hangingFetch = function () { return new Promise(function () {}); };
        let threw = false;
        try {
            await requestScripts({apiKey: 'k', instruction: 'x', timeoutMs: 5}, hangingFetch);
        } catch (e) {
            threw = true;
        }
        expect(threw).toBe(true);
    });
});

describe('buildEnvelopeSystemPrompt (edits contract)', () => {
    test('keeps DSL vocab, drops array-only instruction, teaches add/modify/remove + copy-find + steering', () => {
        const p = buildEnvelopeSystemPrompt();
        expect(p).toMatch(/move/);          // DSL vocab retained
        expect(p).toMatch(/when_flag/);
        expect(p).not.toMatch(/Reply with ONLY a JSON array/i);  // array-mode contradiction gone
        expect(p).toMatch(/"edits"/);
        expect(p).toMatch(/add/);
        expect(p).toMatch(/modify/);
        expect(p).toMatch(/remove/);
        expect(p).toMatch(/find/);
        expect(p.toLowerCase()).toMatch(/copy/);        // copy the find token, don't derive it
        expect(p.toLowerCase()).toMatch(/instead of/);  // replacement steering
        expect(p.toLowerCase()).toMatch(/unchanged|do not mention|kept|is kept/);
    });
    // The free-demo proxy (api/chat.js) rejects any request whose system prompt
    // lacks the marker 'Scratch blocks'. If this phrase is ever reworded here,
    // this test trips so the proxy's APP_MARKER is updated in the same change
    // instead of silently 400-ing every free-mode request.
    test('contains the proxy app-marker "Scratch blocks" (KEEP IN SYNC with api/chat.js APP_MARKER)', () => {
        expect(buildEnvelopeSystemPrompt()).toMatch(/Scratch blocks/);
    });
});

describe('parseEnvelope bare-array lift', () => {
    test('a bare array reply is lifted into all-add edits (model regressed to legacy shape)', () => {
        const out = parseEnvelope('[{"hat":"when_flag","body":[["move",10]]}]');
        expect(out.edits).toEqual([{action: 'add', script: {hat: 'when_flag', body: [['move', 10]]}}]);
        expect(out.answer).toBeUndefined();
    });
});

describe('buildHeaders (per-mode)', () => {
    test('key mode: x-api-key + version + browser-access + content-type', () => {
        const h = buildHeaders({apiKey: 'sk-test'});
        expect(h['x-api-key']).toBe('sk-test');
        expect(h['anthropic-version']).toBe('2023-06-01');
        expect(h['anthropic-dangerous-direct-browser-access']).toBe('true');
        expect(h['content-type']).toBe('application/json');
        expect(h.Authorization).toBeUndefined();
    });
    test('server mode: Authorization Bearer + content-type, no x-api-key', () => {
        const h = buildHeaders({bearer: 'tok-123'});
        expect(h.Authorization).toBe('Bearer tok-123');
        expect(h['content-type']).toBe('application/json');
        expect(h['x-api-key']).toBeUndefined();
        expect(h['anthropic-dangerous-direct-browser-access']).toBeUndefined();
    });
    test('free mode: content-type ONLY (no anthropic headers — proxy CORS allows only content-type)', () => {
        const h = buildHeaders();
        expect(Object.keys(h)).toEqual(['content-type']);
    });
    test('apiKey wins over bearer if both somehow present', () => {
        const h = buildHeaders({apiKey: 'sk', bearer: 'tok'});
        expect(h['x-api-key']).toBe('sk');
        expect(h.Authorization).toBeUndefined();
    });
});

describe('extractText (v1 response shapes)', () => {
    test('canonical Anthropic content shape', () => {
        expect(extractText({content: [{text: 'a'}, {text: 'b'}]})).toBe('ab');
    });
    test('plain {text} fallback', () => {
        expect(extractText({text: 'hi'})).toBe('hi');
    });
    test('OpenAI-style choices fallback', () => {
        expect(extractText({choices: [{message: {content: 'yo'}}]})).toBe('yo');
    });
    test('precedence: content wins over text/choices', () => {
        expect(extractText({content: [{text: 'C'}], text: 'T', choices: [{message: {content: 'X'}}]})).toBe('C');
    });
    test('unknown shape → empty string', () => {
        expect(extractText({weird: true})).toBe('');
        expect(extractText(null)).toBe('');
    });
});

describe('requestTurn / requestScripts endpoint routing', () => {
    const okEnvelope = () => ({
        ok: true,
        json: async () => ({content: [{type: 'text', text: JSON.stringify({answer: 'ok'})}]})
    });
    test('free mode: posts to the given endpoint with content-type only (no x-api-key)', async () => {
        let captured;
        const fetchImpl = async (url, opts) => {
            captured = {url, opts};
            return okEnvelope();
        };
        await requestTurn(
            {endpoint: 'https://proxy.example/api/chat', headers: buildHeaders(), instruction: 'walk'},
            fetchImpl
        );
        expect(captured.url).toBe('https://proxy.example/api/chat');
        expect(captured.opts.headers['x-api-key']).toBeUndefined();
        expect(captured.opts.headers['content-type']).toBe('application/json');
    });
    test('server mode: posts to endpoint with Authorization Bearer', async () => {
        let captured;
        const fetchImpl = async (url, opts) => {
            captured = {url, opts};
            return {ok: true, json: async () => ({content: [{text: '[{"hat":"when_flag","body":[]}]'}]})};
        };
        await requestScripts(
            {endpoint: 'https://gw.example/v1/messages', headers: buildHeaders({bearer: 't'}), instruction: 'x'},
            fetchImpl
        );
        expect(captured.url).toBe('https://gw.example/v1/messages');
        expect(captured.opts.headers.Authorization).toBe('Bearer t');
    });
    test('key mode (no endpoint): still posts to Anthropic with x-api-key (unchanged default)', async () => {
        let captured;
        const fetchImpl = async (url, opts) => {
            captured = {url, opts};
            return okEnvelope();
        };
        await requestTurn({apiKey: 'sk-x', instruction: 'walk'}, fetchImpl);
        expect(captured.url).toMatch(/api\.anthropic\.com/);
        expect(captured.opts.headers['x-api-key']).toBe('sk-x');
        expect(captured.opts.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    });
    test('reads a choices-shaped success body from a custom server', async () => {
        const fetchImpl = async () => ({
            ok: true,
            json: async () => ({choices: [{message: {content: JSON.stringify({answer: 'hey'})}}]})
        });
        const out = await requestTurn(
            {endpoint: 'https://gw.example', headers: buildHeaders({bearer: 't'}), instruction: 'x'},
            fetchImpl
        );
        expect(out.answer).toBe('hey');
    });
});
