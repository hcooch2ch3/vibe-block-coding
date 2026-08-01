import {
    DEFAULT_MODEL,
    buildSystemPrompt,
    buildUserPrompt,
    parseDSL,
    parseEnvelope,
    requestScripts,
    requestTurn,
    ENVELOPE_MAX_TOKENS
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

describe('parseEnvelope', () => {
    test('answer only', () => {
        const out = parseEnvelope('{"answer":"Use the move block!"}');
        expect(out.answer).toBe('Use the move block!');
        expect(out.blocks).toBeUndefined();
    });
    test('answer + valid blocks', () => {
        const out = parseEnvelope('{"answer":"ok","blocks":[{"hat":"when_clicked","body":[["move",10]]}]}');
        expect(out.answer).toBe('ok');
        expect(out.blocks).toHaveLength(1);
    });
    test('malformed blocks keeps answer, drops blocks (fail-closed)', () => {
        const out = parseEnvelope('{"answer":"tried","blocks":[{"hat":"nope","body":[]}]}');
        expect(out.answer).toBe('tried');
        expect(out.blocks).toBeUndefined();
    });
    test('empty blocks array is not a silent success', () => {
        const out = parseEnvelope('{"answer":"hmm","blocks":[]}');
        expect(out.blocks).toBeUndefined(); // empty → treated as no blocks
    });
    test('unparseable → throws (caller shows retry nudge)', () => {
        expect(() => parseEnvelope('not json at all %%%')).toThrow();
    });
    test('truncated mid-JSON keeps the leading answer, drops blocks', () => {
        const out = parseEnvelope('{"answer":"Here you go!","blocks":[{"hat":"when_clicked","body":[["mov');
        expect(out.answer).toBe('Here you go!');
        expect(out.blocks).toBeUndefined();
    });

    // Over-match guard: salvage must NOT fire on an "answer" nested inside blocks.
    // Before the fix, the regex lifts the nested "answer" and returns it silently.
    test('parseEnvelope: does not salvage an "answer" nested inside blocks (over-match guard)', () => {
        const text = '{"blocks":[{"hat":"when_clicked","answer":"not a real answer"}';
        expect(() => parseEnvelope(text)).toThrow();
    });

    test('parseEnvelope: empty/whitespace answer with valid blocks keeps blocks, drops answer', () => {
        const out = parseEnvelope('{"answer":"   ","blocks":[{"hat":"when_clicked","body":[["move",10]]}]}');
        expect(out.answer).toBeUndefined();
        expect(out.blocks).toHaveLength(1);
    });

    test('parseEnvelope: non-string answer is ignored, blocks still parsed', () => {
        const out = parseEnvelope('{"answer":123,"blocks":[{"hat":"when_clicked","body":[["move",10]]}]}');
        expect(out.answer).toBeUndefined();
        expect(out.blocks).toHaveLength(1);
    });

    // Item 4 — PIN test: sliceJSON uses lastIndexOf('}'), which on a truncated reply
    // ending at a nested '}' produces an unbalanced slice that JSON.parse rejects.
    // Therefore the success path cannot be taken with wrong data; salvage runs instead.
    // This test pins that nested-'}' truncation stays on the salvage path (not success).
    test('parseEnvelope: truncated at nested "}" salvages top-level answer (sliceJSON nested-} pin)', () => {
        // Last '}' is the nested script's close, not the outer close — slice is unbalanced.
        // JSON.parse throws, salvage fires on the top-level "answer".
        const out = parseEnvelope('{"answer":"real","blocks":[{"hat":"when_flag","body":[]}');
        expect(out.answer).toBe('real');
        expect(out.blocks).toBeUndefined();
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
    test('requestTurn returns the envelope and uses the raised token cap', async () => {
        const fetchImpl = jest.fn(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({content: [{text: '{"answer":"hi","blocks":[{"hat":"when_clicked","body":[["move",10]]}]}'}]})
        }));
        const out = await requestTurn({apiKey: 'k', instruction: 'walk'}, fetchImpl);
        expect(out.answer).toBe('hi');
        expect(out.blocks).toHaveLength(1);
        const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
        expect(body.max_tokens).toBe(ENVELOPE_MAX_TOKENS);
    });
});
