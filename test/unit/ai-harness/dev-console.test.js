// The generate/edit helpers behind window.vibe, the reusable core the live
// smoke test and (week 2) the UI both call. Driven against a real headless
// scratch-vm; only fetch is mocked.
import {generate, edit, measureBuildRate, measureEditQuality, propose, applyProposal} from '../../../src/lib/ai-harness/dev-console';
import {compile, decompile, scriptHatIds, editableHatIds} from '../../../src/lib/ai-harness/dsl';
import {hashProgram} from '../../../src/lib/ai-harness/base-hash';
import {scriptFingerprint} from '../../../src/lib/ai-harness/edit';
import {makeHeadlessVM, reachableIds} from './headless-target';

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

// envelope: mock an Anthropic response returning the id+fingerprint edits envelope.
// The second arg is an array of scripts; each becomes an `add` edit (build turns).
const envelope = (answer, scripts) => Promise.resolve({
    ok: true, json: () => Promise.resolve({content: [{text: JSON.stringify({
        answer, edits: (scripts || []).map(s => ({action: 'add', script: s}))
    })}]})
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

// editsEnvelope: mock an Anthropic response returning an explicit edits list.
const editsEnvelope = (answer, edits) => Promise.resolve({
    ok: true, json: () => Promise.resolve({content: [{text: JSON.stringify({answer, edits})}]})
});

describe('propose/applyProposal, id+fingerprint edits', () => {
    const s = body => ({hat: 'when_flag', body});
    const fp = scriptFingerprint;
    const seed = (vm, target, scripts) => vm.shareBlocksToTarget(compile(scripts), target.id);

    test('propose does not mutate the workspace (no injection)', async () => {
        const {vm, target} = makeHeadlessVM();
        await seed(vm, target, [s([['forever', [['turn', 15]]]])]);
        const before = decompile(target.blocks);
        const shareSpy = jest.spyOn(vm, 'shareBlocksToTarget');
        await propose(vm, {apiKey: 'k', instruction: 'walk around', targetId: target.id},
            () => editsEnvelope('walk', [{action: 'add', script: s([['move', 10]])}]));
        expect(shareSpy).not.toHaveBeenCalled();
        expect(decompile(target.blocks)).toEqual(before);
    });

    test('ADD keeps the existing spin script (the reported bug)', async () => {
        const {vm, target} = makeHeadlessVM();
        await seed(vm, target, [s([['say', 'Hello']]), s([['forever', [['turn', 15]]]])]);
        const {proposal} = await propose(vm, {apiKey: 'k', instruction: 'walk around', targetId: target.id},
            () => editsEnvelope('walk', [
                {action: 'add', script: s([['forever', [['move', 10], ['if_on_edge_bounce']]]])}
            ]));
        expect(proposal.kind).toBe('edit');
        expect(proposal.ops).toEqual([
            {type: 'add', index: null, script: s([['forever', [['move', 10], ['if_on_edge_bounce']]]])}
        ]);
        expect(proposal.baseStamp).toEqual({targetId: target.id, baseHash: hashProgram(decompile(target.blocks))});
        const res = await applyProposal(vm, proposal);
        expect(res.ok).toBe(true);
        const after = decompile(target.blocks);
        expect(after.length).toBe(3);
        expect(JSON.stringify(after)).toMatch(/"turn"/);   // spin survived
    });

    test('propose+apply on a workspace with an UNKNOWN block: no crash, block preserved', async () => {
        const {vm, target} = makeHeadlessVM();
        // Representable script, then a hand-built script the DSL cannot represent
        // (when_flag -> control_if). This is the exact case that used to throw in propose().
        await seed(vm, target, [s([['move', 10]])]);
        await vm.shareBlocksToTarget([
            {id: 'uhat', opcode: 'event_whenflagclicked', inputs: {}, fields: {},
                next: 'uif', parent: null, topLevel: true, shadow: false, x: 220, y: 220},
            {id: 'uif', opcode: 'control_if', inputs: {}, fields: {},
                next: null, parent: 'uhat', topLevel: false, shadow: false}
        ], target.id);

        // The unknown script is invisible to the editable program; propose sees only [move].
        const current = decompile(target.blocks);
        expect(current).toEqual([s([['move', 10]])]);

        // The inert hat + its if-block, captured by vm id (newBlockIds rewrote the literals).
        const editable = new Set(editableHatIds(target.blocks));
        const inertHat = scriptHatIds(target.blocks).find(id => !editable.has(id));
        const inertBefore = reachableIds(target.blocks, inertHat);
        expect(inertBefore.length).toBe(2);

        // Real production entry point: propose must NOT throw on the unknown block, and must
        // resolve a modify of the representable script #1.
        const {proposal} = await propose(vm, {apiKey: 'k', instruction: 'say hi instead', targetId: target.id},
            () => editsEnvelope('ok', [
                {action: 'modify', id: 1, find: fp(current[0]), script: s([['say', 'hi']])}
            ]));
        expect(proposal.kind).toBe('edit');

        const res = await applyProposal(vm, proposal);
        expect(res.ok).toBe(true);
        // Unknown script untouched (no data loss) AND the representable script changed.
        expect(reachableIds(target.blocks, inertHat)).toEqual(inertBefore);
        expect(decompile(target.blocks)).toEqual([s([['say', 'hi']])]);
    });

    test('REPLACEMENT: remove #id (find copied) deletes only that script', async () => {
        const {vm, target} = makeHeadlessVM();
        const current = [s([['forever', [['turn', 15]]]]), s([['say', 'Hi']])]; // #1 spin, #2 say
        await seed(vm, target, current);
        const {proposal} = await propose(vm, {apiKey: 'k', instruction: 'walk instead of spin', targetId: target.id},
            () => editsEnvelope('walk not spin', [
                {action: 'remove', id: 1, find: fp(current[0])},
                {action: 'add', script: s([['forever', [['move', 10]]]])}
            ]));
        const res = await applyProposal(vm, proposal);
        expect(res.ok).toBe(true);
        const after = JSON.stringify(decompile(target.blocks));
        expect(after).not.toMatch(/"turn"/);   // spin removed
        expect(after).toMatch(/"move"/);        // walk added
        expect(after).toMatch(/"say"/);         // say kept
    });

    test('WRONG id (find mismatch) is dropped, no destructive edit (C2)', async () => {
        const {vm, target} = makeHeadlessVM();
        const current = [s([['say', 'Hello']]), s([['forever', [['turn', 15]]]])];
        await seed(vm, target, current);
        // model means to remove #2 (spin) but writes id:1; find describes #2
        const out = await propose(vm, {apiKey: 'k', instruction: 'x', targetId: target.id},
            () => editsEnvelope('oops', [{action: 'remove', id: 1, find: fp(current[1])}]));
        expect(out.proposal).toBeUndefined();
        expect(out.answer).toBe('oops');
    });

    test('answer-only reply yields no proposal', async () => {
        const {vm, target} = makeHeadlessVM();
        const out = await propose(vm, {apiKey: 'k', instruction: 'what color?', targetId: target.id},
            () => editsEnvelope('orange!', undefined));
        expect(out.proposal).toBeUndefined();
        expect(out.answer).toBe('orange!');
    });

    test('empty target: adds create the program', async () => {
        const {vm, target} = makeHeadlessVM();
        const {proposal} = await propose(vm, {apiKey: 'k', instruction: 'jump', targetId: target.id},
            () => editsEnvelope('jump', [{action: 'add', script: s([['change_y', 50]])}]));
        const res = await applyProposal(vm, proposal);
        expect(res.ok).toBe(true);
        expect(decompile(target.blocks)).toEqual([s([['change_y', 50]])]);
    });

    test('changedTopIds: only the added/replaced hats, kept ones excluded', async () => {
        const {vm, target} = makeHeadlessVM();
        const current = [s([['move', 10]]), s([['say', 'hi']])];
        await seed(vm, target, current);
        const keptBefore = scriptHatIds(target.blocks);
        const {proposal} = await propose(vm, {apiKey: 'k', instruction: 'change second', targetId: target.id},
            () => editsEnvelope('ok', [
                {action: 'modify', id: 2, find: fp(current[1]), script: s([['say', 'bye']])}
            ]));
        const out = await applyProposal(vm, proposal);
        expect(out.ok).toBe(true);
        expect(out.changedTopIds.length).toBe(1);
        out.changedTopIds.forEach(id => expect(keptBefore).not.toContain(id));
        out.changedTopIds.forEach(id => expect(target.blocks.getBlock(id)).toBeTruthy());
    });

    test('fails closed on a stale workspace, no injection', async () => {
        const {vm, target} = makeHeadlessVM();
        await seed(vm, target, [s([['move', 10]])]);
        const {proposal} = await propose(vm, {apiKey: 'k', instruction: 'say hi', targetId: target.id},
            () => editsEnvelope('ok', [{action: 'add', script: s([['say', 'hi']])}]));
        // child hand-edits AFTER proposing → base no longer matches
        await vm.shareBlocksToTarget(compile([s([['move', 5]])]), target.id);
        const before = decompile(target.blocks);
        const shareSpy = jest.spyOn(vm, 'shareBlocksToTarget');
        const out = await applyProposal(vm, proposal);
        expect(out).toEqual({ok: false, stale: true});
        expect(shareSpy).not.toHaveBeenCalled();
        expect(decompile(target.blocks)).toEqual(before);
    });

    test('legacy proposal without ops → stale (back-compat guard)', async () => {
        const {vm, target} = makeHeadlessVM();
        expect(await applyProposal(vm, {kind: 'edit', baseStamp: {targetId: target.id, baseHash: 'x'}}))
            .toEqual({ok: false, stale: true});
    });
});

describe('measureEditQuality (scores via the production editsToOps path)', () => {
    const s = body => ({hat: 'when_flag', body});
    const fp = scriptFingerprint;
    const reply = edits => Promise.resolve({
        ok: true, json: () => Promise.resolve({content: [{text: JSON.stringify({answer: 'x', edits})}]})
    });

    test('a clean add scores correct; a wrong-find remove is dropped by the gate → incorrect', async () => {
        const {vm} = makeHeadlessVM();
        const spin = [s([['forever', [['turn', 15]]]])];
        const cases = [
            {instruction: 'also walk', currentScripts: spin, expect: {action: 'add'}},
            {instruction: 'stop spinning', currentScripts: spin, expect: {action: 'remove', findIndex: 0}}
        ];
        let call = 0;
        const fetchImpl = () => (call++ === 0 ?
            reply([{action: 'add', script: s([['move', 10]])}]) :
            reply([{action: 'remove', id: 1, find: 'WRONGHASH'}]));
        expect(await measureEditQuality(vm, {apiKey: 'k', cases}, fetchImpl)).toEqual({total: 2, correct: 1, rate: 0.5});
    });

    test('an exact find + right id scores correct', async () => {
        const {vm} = makeHeadlessVM();
        const spin = [s([['forever', [['turn', 15]]]])];
        const fetchImpl = () => reply([{action: 'remove', id: 1, find: fp(spin[0])}]);
        expect(await measureEditQuality(vm, {apiKey: 'k', cases: [
            {instruction: 'stop spinning', currentScripts: spin, expect: {action: 'remove', findIndex: 0}}
        ]}, fetchImpl)).toEqual({total: 1, correct: 1, rate: 1});
    });

    test('a SUBSTRING of the true fingerprint is not accepted (exact, not includes)', async () => {
        const {vm} = makeHeadlessVM();
        const spin = [s([['forever', [['turn', 15]]]])];
        const fetchImpl = () => reply([{action: 'remove', id: 1, find: fp(spin[0]).slice(0, -1)}]);
        expect((await measureEditQuality(vm, {apiKey: 'k', cases: [
            {instruction: 'stop spinning', currentScripts: spin, expect: {action: 'remove', findIndex: 0}}
        ]}, fetchImpl)).correct).toBe(0);
    });

    test('right find but WRONG id → dropped by the id-based gate → incorrect (mirrors production)', async () => {
        const {vm} = makeHeadlessVM();
        const prog = [s([['move', 10]]), s([['forever', [['turn', 15]]]])]; // #1 A, #2 B
        // model wants to remove #2 (B), copies B's find, but writes id:1 → editsToOps drops it
        const fetchImpl = () => reply([{action: 'remove', id: 1, find: fp(prog[1])}]);
        expect((await measureEditQuality(vm, {apiKey: 'k', cases: [
            {instruction: 'remove the spin', currentScripts: prog, expect: {action: 'remove', findIndex: 1}}
        ]}, fetchImpl)).correct).toBe(0);
    });

    test('a correct edit BUNDLED with a spurious valid edit → incorrect (production applies both)', async () => {
        const {vm} = makeHeadlessVM();
        const prog = [s([['move', 10]]), s([['say', 'hi']])];
        const fetchImpl = () => reply([
            {action: 'remove', id: 2, find: fp(prog[1])},                              // the asked-for edit
            {action: 'modify', id: 1, find: fp(prog[0]), script: s([['move', 99]])}    // spurious extra
        ]);
        expect((await measureEditQuality(vm, {apiKey: 'k', cases: [
            {instruction: 'just remove the talking', currentScripts: prog, expect: {action: 'remove', findIndex: 1}}
        ]}, fetchImpl)).correct).toBe(0);
    });

    test('an all-adds full-program resend fails an add-case (surfaces the duplicate regression)', async () => {
        const {vm} = makeHeadlessVM();
        const prog = [s([['move', 10]])];
        const fetchImpl = () => reply([
            {action: 'add', script: s([['move', 10]])},
            {action: 'add', script: s([['say', 'hi']])}
        ]);
        expect((await measureEditQuality(vm, {apiKey: 'k', cases: [
            {instruction: 'also say hi', currentScripts: prog, expect: {action: 'add'}}
        ]}, fetchImpl)).correct).toBe(0);
    });

    test('rejects non-array cases (console footgun guard)', async () => {
        const {vm} = makeHeadlessVM();
        let err;
        try {
            await measureEditQuality(vm, {apiKey: 'k', cases: 'nope'});
        } catch (e) {
            err = e;
        }
        expect(err).toBeInstanceOf(TypeError);
    });
});
