// The generate/edit helpers behind window.vibe — the reusable core the live
// smoke test and (week 2) the UI both call. Driven against a real headless
// scratch-vm; only fetch is mocked.
import {generate, edit, measureBuildRate} from '../../../src/lib/ai-harness/dev-console';
import {decompile} from '../../../src/lib/ai-harness/dsl';
import {makeHeadlessVM} from './headless-target';

// fakeVm: a minimal vm stub for measureBuildRate (vm is unused-but-kept for
// signature stability with the window.vibe.measure wrapper).
const fakeVm = () => {
    const target = {id: 't1', blocks: {}};
    return {
        editingTarget: target,
        runtime: {getTargetById: id => (id === 't1' ? target : null)},
        shareBlocksToTarget: jest.fn(() => Promise.resolve()),
        refreshWorkspace: jest.fn()
    };
};

// envelope: mock an Anthropic response returning a unified-chat envelope
// {answer, blocks} (the shape requestTurn/parseEnvelope consume).
const envelope = (answer, blocks) => Promise.resolve({
    ok: true, json: () => Promise.resolve({content: [{text: JSON.stringify({answer, blocks})}]})
});

const flag = body => ({hat: 'when_flag', body});
const asSet = scripts => scripts.map(s => JSON.stringify(s)).sort();

const fetchReturning = scripts => async () => ({
    ok: true,
    json: async () => ({content: [{type: 'text', text: JSON.stringify(scripts)}]})
});

describe('generate', () => {
    test('turns an instruction into blocks on the vm target', async () => {
        const {vm, target} = makeHeadlessVM();
        const result = await generate(
            vm,
            {apiKey: 'k', instruction: 'walk'},
            fetchReturning([flag([['move', 10]])])
        );
        expect(result).toEqual([flag([['move', 10]])]);
        expect(decompile(target.blocks)).toEqual([flag([['move', 10]])]);
    });
});

describe('edit', () => {
    test('edits the current program in place, preserving untouched work', async () => {
        const {vm, target} = makeHeadlessVM();
        await generate(vm, {apiKey: 'k', instruction: 'walk'},
            fetchReturning([flag([['move', 10]])]));

        const result = await edit(
            vm,
            {apiKey: 'k', instruction: 'say hi too'},
            fetchReturning([flag([['move', 10], ['say', 'hi']])])
        );
        expect(asSet(result)).toEqual(asSet([flag([['move', 10], ['say', 'hi']])]));
        expect(asSet(decompile(target.blocks)))
            .toEqual(asSet([flag([['move', 10], ['say', 'hi']])]));
    });
});

describe('measureBuildRate', () => {
    test('reports produced/total/rate (envelope path)', async () => {
        // First prompt returns an envelope with blocks → counts as produced.
        // Second prompt returns an envelope with empty blocks → not produced.
        const fetchImpl = jest.fn()
            .mockImplementationOnce(() => envelope('ok', [{hat: 'when_flag', body: [['move', 10]]}]))
            .mockImplementationOnce(() => envelope('hmm', []));
        const out = await measureBuildRate(
            fakeVm(),
            {apiKey: 'k', prompts: ['walk', 'nonsense']},
            fetchImpl
        );
        expect(out.total).toBe(2);
        expect(out.produced).toBe(1);
        expect(out.rate).toBeCloseTo(0.5);
    });

    test('measureBuildRate rejects a non-array prompts (browser-console footgun guard)', async () => {
        let err;
        try {
            await measureBuildRate(fakeVm(), {apiKey: 'k', prompts: 'walk'});
        } catch (e) {
            err = e;
        }
        expect(err).toBeInstanceOf(TypeError);
        expect(err.message).toMatch('measureBuildRate: prompts must be an array');
    });

    test('measureBuildRate counts a thrown turn as not produced', async () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const fetchImpl = jest.fn()
            .mockImplementationOnce(() => envelope('ok', [{hat: 'when_clicked', body: [['move', 10]]}]))
            .mockImplementationOnce(() => Promise.reject(new Error('network')));
        const out = await measureBuildRate(fakeVm(), {apiKey: 'k', prompts: ['walk', 'boom']}, fetchImpl);
        expect(out.total).toBe(2);
        expect(out.produced).toBe(1);
        expect(out.rate).toBeCloseTo(0.5);
        warnSpy.mockRestore();
    });
});
