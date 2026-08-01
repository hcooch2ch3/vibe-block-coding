// The generate/edit helpers behind window.vibe — the reusable core the live
// smoke test and (week 2) the UI both call. Driven against a real headless
// scratch-vm; only fetch is mocked.
import {generate, edit, measureBuildRate, propose, applyProposal} from '../../../src/lib/ai-harness/dev-console';
import {compile, decompile} from '../../../src/lib/ai-harness/dsl';
import {hashProgram} from '../../../src/lib/ai-harness/base-hash';
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

// Helper: build a fetch stub returning an envelope with the given answer+blocks.
const blocksFetch = (answer, blocks) => jest.fn(() => envelope(answer, blocks));

describe('propose', () => {
    test('propose holds blocks — no injection, workspace untouched', async () => {
        const {vm, target} = makeHeadlessVM();
        const shareSpy = jest.spyOn(vm, 'shareBlocksToTarget');
        const {answer, proposal} = await propose(
            vm, {apiKey: 'k', instruction: 'walk', targetId: target.id},
            blocksFetch('ok', [{hat: 'when_clicked', body: [['move', 10]]}]));
        expect(answer).toBe('ok');
        expect(proposal.kind).toBe('generate');
        expect(proposal.baseStamp).toEqual({targetId: target.id, baseHash: hashProgram([])});
        expect(shareSpy).not.toHaveBeenCalled();
        expect(decompile(target.blocks)).toEqual([]);
    });

    test('propose returns answer-only when the model returns no blocks', async () => {
        const {vm, target} = makeHeadlessVM();
        const out = await propose(
            vm, {apiKey: 'k', instruction: 'what is a sprite?', targetId: target.id},
            jest.fn(() => envelope('A sprite is a character!', [])));
        expect(out.answer).toBe('A sprite is a character!');
        expect(out.proposal).toBeUndefined();
    });
});

describe('applyProposal', () => {
    test('applyProposal injects a fresh generate proposal', async () => {
        const {vm, target} = makeHeadlessVM();
        const proposal = {kind: 'generate', blocks: [{hat: 'when_clicked', body: [['move', 10]]}],
            baseStamp: {targetId: target.id, baseHash: hashProgram([])}};
        const out = await applyProposal(vm, proposal);
        expect(out).toEqual({ok: true});
        expect(decompile(target.blocks)).toEqual([{hat: 'when_clicked', body: [['move', 10]]}]);
    });

    // critic #1 — the core stale-guard integration test (generate)
    test('applyProposal fails closed on a stale workspace — no injection', async () => {
        const {vm, target} = makeHeadlessVM();
        const {proposal} = await propose(
            vm, {apiKey: 'k', instruction: 'walk', targetId: target.id},
            blocksFetch('ok', [{hat: 'when_clicked', body: [['move', 10]]}]));
        // child hand-edits AFTER proposing → base no longer matches
        await vm.shareBlocksToTarget(compile([{hat: 'when_flag', body: [['move', 5]]}]), target.id);
        const before = decompile(target.blocks);
        const shareSpy = jest.spyOn(vm, 'shareBlocksToTarget');
        const out = await applyProposal(vm, proposal);
        expect(out).toEqual({ok: false, stale: true});
        expect(shareSpy).not.toHaveBeenCalled();          // neither shareBlocksToTarget...
        expect(decompile(target.blocks)).toEqual(before); // ...nor applyEdit ran
    });

    // stale EDIT proposal (constructed) — hash mismatch → no injection
    test('applyProposal fails closed on a stale edit proposal', async () => {
        const {vm, target} = makeHeadlessVM();
        const shareSpy = jest.spyOn(vm, 'shareBlocksToTarget');
        const proposal = {kind: 'edit', oldScripts: [], newScripts: [{hat: 'when_flag', body: [['move', 10]]}],
            baseStamp: {targetId: target.id, baseHash: 'STALE'}}; // live empty → '[]' !== 'STALE'
        const out = await applyProposal(vm, proposal);
        expect(out).toEqual({ok: false, stale: true});
        expect(shareSpy).not.toHaveBeenCalled();
    });

    // A3a — real propose→edit→apply round-trip: edit proposal applies and workspace reflects edit
    test('applyProposal edit happy path — real propose→edit→apply round-trip', async () => {
        const {vm, target} = makeHeadlessVM();
        // Seed the target with an initial generate so it is non-empty at propose time.
        const seedFetch = fetchReturning([flag([['move', 10]])]);
        await generate(vm, {apiKey: 'k', instruction: 'walk', targetId: target.id}, seedFetch);
        // propose with the target non-empty → kind:'edit'
        const editedScript = flag([['move', 10], ['say', 'hi']]);
        const {proposal} = await propose(
            vm,
            {apiKey: 'k', instruction: 'also say hi', targetId: target.id},
            blocksFetch('ok', [editedScript])
        );
        expect(proposal.kind).toBe('edit');
        // apply the edit proposal
        const out = await applyProposal(vm, proposal);
        expect(out).toEqual({ok: true});
        expect(asSet(decompile(target.blocks))).toEqual(asSet([editedScript]));
    });

    // A3b — real-flow edit stale: hand-edit after propose → applyProposal detects stale
    test('applyProposal edit stale — workspace edited between propose and apply', async () => {
        const {vm, target} = makeHeadlessVM();
        // Seed so target is non-empty.
        await generate(vm, {apiKey: 'k', instruction: 'walk', targetId: target.id},
            fetchReturning([flag([['move', 10]])]));
        // propose an edit
        const {proposal} = await propose(
            vm,
            {apiKey: 'k', instruction: 'also say hi', targetId: target.id},
            blocksFetch('ok', [flag([['move', 10], ['say', 'hi']])])
        );
        expect(proposal.kind).toBe('edit');
        // hand-edit the workspace AFTER propose → hash diverges
        await vm.shareBlocksToTarget(
            compile([flag([['move', 99]])]),
            target.id
        );
        const beforeApply = decompile(target.blocks);
        const shareSpy = jest.spyOn(vm, 'shareBlocksToTarget');
        const out = await applyProposal(vm, proposal);
        expect(out).toEqual({ok: false, stale: true});
        expect(shareSpy).not.toHaveBeenCalled();
        expect(asSet(decompile(target.blocks))).toEqual(asSet(beforeApply));
    });
});
