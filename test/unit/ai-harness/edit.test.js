import {diff, applyEdit, applyOps, editsToOps, scriptFingerprint} from '../../../src/lib/ai-harness/edit';
import {compile, decompile, scriptHatIds} from '../../../src/lib/ai-harness/dsl';
import {makeHeadlessVM, reachableIds} from './headless-target';

// A DSL script is {hat, body:[[op, ...args], ...]}.
const flag = body => ({hat: 'when_flag', body});

async function seed (vm, scripts) {
    await vm.shareBlocksToTarget(compile(scripts), vm.editingTarget.id);
}

describe('diff (old -> new DSL, per-script ops)', () => {
    test('identical scripts produce only keep ops (no-op edit)', () => {
        const scripts = [flag([['move', 10], ['say', 'hi']])];
        const ops = diff(scripts, scripts);
        expect(ops).toEqual([{type: 'keep', index: 0}]);
        expect(ops.some(o => o.type !== 'keep')).toBe(false);
    });

    test('empty -> empty produces no ops', () => {
        expect(diff([], [])).toEqual([]);
    });

    test('a changed body value yields a replace carrying the new script', () => {
        const oldS = [flag([['move', 10]])];
        const newS = [flag([['move', 25]])];
        expect(diff(oldS, newS)).toEqual([
            {type: 'replace', index: 0, script: newS[0]}
        ]);
    });

    test('an appended script yields an add', () => {
        const oldS = [flag([['move', 10]])];
        const newS = [flag([['move', 10]]), flag([['say', 'yo']])];
        expect(diff(oldS, newS)).toEqual([
            {type: 'keep', index: 0},
            {type: 'add', index: 1, script: newS[1]}
        ]);
    });

    test('a dropped trailing script yields a remove', () => {
        const oldS = [flag([['move', 10]]), flag([['say', 'yo']])];
        const newS = [flag([['move', 10]])];
        expect(diff(oldS, newS)).toEqual([
            {type: 'keep', index: 0},
            {type: 'remove', index: 1}
        ]);
    });

    test('unchanged script stays kept while a sibling changes (real 기존 보존)', () => {
        const oldS = [flag([['move', 10]]), flag([['say', 'a']])];
        const newS = [flag([['move', 10]]), flag([['say', 'b']])];
        expect(diff(oldS, newS)).toEqual([
            {type: 'keep', index: 0},
            {type: 'replace', index: 1, script: newS[1]}
        ]);
    });

    test('numeric args equal their string form (LLM may return numbers as strings)', () => {
        // decompile() coerces numeric fields to Number; an LLM often emits "10".
        // diff must treat these as the same script, or every edit degrades to replace.
        const oldS = [flag([['move', 10], ['say', 'hi']])];
        const newS = [flag([['move', '10'], ['say', 'hi']])];
        expect(diff(oldS, newS)).toEqual([{type: 'keep', index: 0}]);
    });
});

// Compare script arrays ignoring order (scratch scripts are position-anchored;
// applyEdit preserves block identity + x/y, not _scripts array order).
const asSet = scripts => scripts.map(s => JSON.stringify(s)).sort();

describe('applyEdit (headless real scratch-vm)', () => {
    test('no-op edit leaves every block id untouched', async () => {
        const {vm, target} = makeHeadlessVM();
        await seed(vm, [flag([['move', 10], ['say', 'hi']])]);
        const before = Object.keys(target.blocks._blocks).sort();

        const current = decompile(target.blocks);
        const ops = await applyEdit(vm, current, current);

        expect(ops.every(o => o.type === 'keep')).toBe(true);
        expect(Object.keys(target.blocks._blocks).sort()).toEqual(before);
    });

    test('changed value rebuilds only that script and preserves its position', async () => {
        const {vm, target} = makeHeadlessVM();
        await seed(vm, [flag([['move', 10]])]);
        // Move the script so we can prove x/y survives the rebuild.
        const oldHat = target.blocks.getBlock(scriptHatIds(target.blocks)[0]);
        oldHat.x = 200;
        oldHat.y = 150;

        const oldD = decompile(target.blocks);
        const newD = [flag([['move', 25]])];
        await applyEdit(vm, oldD, newD);

        expect(decompile(target.blocks)).toEqual(newD);
        const newHat = target.blocks.getBlock(scriptHatIds(target.blocks)[0]);
        expect([newHat.x, newHat.y]).toEqual([200, 150]);
    });

    test('editing one script keeps the untouched sibling\'s exact block ids', async () => {
        const {vm, target} = makeHeadlessVM();
        await seed(vm, [flag([['move', 10]]), flag([['say', 'a']])]);
        const keptHatId = scriptHatIds(target.blocks)[0];
        const keptIds = reachableIds(target.blocks, keptHatId);

        const oldD = decompile(target.blocks);
        const newD = [flag([['move', 10]]), flag([['say', 'b']])];
        await applyEdit(vm, oldD, newD);

        // Every id of the untouched script still exists, byte-for-byte.
        keptIds.forEach(id => expect(target.blocks.getBlock(id)).toBeDefined());
        expect(decompile(target.blocks)).toEqual(newD);
    });

    test('replacing the FIRST of two scripts still preserves the untouched second', async () => {
        // Regression: rebuilt scripts append to _scripts, so array order may differ
        // from newScripts. Identity + position of the untouched script must survive.
        const {vm, target} = makeHeadlessVM();
        await seed(vm, [flag([['move', 10]]), flag([['say', 'keep']])]);
        const keptHatId = scriptHatIds(target.blocks)[1];
        const keptIds = reachableIds(target.blocks, keptHatId);

        const oldD = decompile(target.blocks);
        const newD = [flag([['move', 99]]), flag([['say', 'keep']])];
        await applyEdit(vm, oldD, newD);

        keptIds.forEach(id => expect(target.blocks.getBlock(id)).toBeDefined());
        expect(asSet(decompile(target.blocks))).toEqual(asSet(newD));
    });

    test('an added script appears and a removed script disappears', async () => {
        const {vm, target} = makeHeadlessVM();
        await seed(vm, [flag([['move', 10]])]);

        // add
        await applyEdit(vm, decompile(target.blocks),
            [flag([['move', 10]]), flag([['say', 'yo']])]);
        expect(decompile(target.blocks)).toEqual(
            [flag([['move', 10]]), flag([['say', 'yo']])]);

        // remove the second one back out
        await applyEdit(vm, decompile(target.blocks), [flag([['move', 10]])]);
        expect(decompile(target.blocks)).toEqual([flag([['move', 10]])]);
    });
});

describe('substack editing', () => {
    test('string vs number inside a loop is a no-op (keep, ids unchanged)', async () => {
        const {vm, target} = makeHeadlessVM();
        await seed(vm, [flag([['repeat', 3, [['move', 10]]]])]);
        const before = decompile(target.blocks);
        const beforeHatId = scriptHatIds(target.blocks)[0];
        // same program but numbers as strings (as an LLM might return)
        const asStrings = [{hat: 'when_flag', body: [['repeat', '3', [['move', '10']]]]}];
        await applyEdit(vm, before, asStrings);
        expect(scriptHatIds(target.blocks)[0]).toBe(beforeHatId); // not rebuilt
        expect(decompile(target.blocks)).toEqual(before);
    });
    test('editing inside a loop rebuilds only that script; sibling + no leak', async () => {
        // applyEdit deletes+re-shares the replaced script, so rebuilt scripts APPEND
        // to _scripts — array order differs. Assert order-insensitively (asSet) and
        // check the sibling by id (reachableIds), like the FIRST-of-two test above.
        const {vm, target} = makeHeadlessVM();
        await seed(vm, [
            flag([['repeat', 3, [['move', 10]]]]),
            {hat: 'when_clicked', body: [['say', 'hi']]}
        ]);
        const before = decompile(target.blocks);
        const siblingHatId = scriptHatIds(target.blocks)[1];
        const keptIds = reachableIds(target.blocks, siblingHatId);
        const replacedHatId = scriptHatIds(target.blocks)[0];
        const replacedIds = reachableIds(target.blocks, replacedHatId);
        const edited = [
            {hat: 'when_flag', body: [['repeat', 3, [['move', 10], ['turn', 15]]]]},
            before[1]
        ];
        await applyEdit(vm, before, edited);
        keptIds.forEach(id => expect(target.blocks.getBlock(id)).toBeDefined()); // sibling survives
        replacedIds.forEach(id => expect(target.blocks.getBlock(id)).toBeUndefined()); // old loop body gone
        expect(asSet(decompile(target.blocks))).toEqual(asSet(edited));
    });
    test('a flat script edited into a loop leaves no orphan blocks', async () => {
        const {vm, target} = makeHeadlessVM();
        await seed(vm, [flag([['move', 10]])]);
        const before = decompile(target.blocks);
        const oldIds = reachableIds(target.blocks, scriptHatIds(target.blocks)[0]);
        const edited = [flag([['repeat', 3, [['move', 10]]]])];
        await applyEdit(vm, before, edited);
        oldIds.forEach(id => expect(target.blocks.getBlock(id)).toBeUndefined()); // old flat blocks gone
        expect(asSet(decompile(target.blocks))).toEqual(asSet(edited));
    });
    test('a loop script edited back to flat removes the substack blocks', async () => {
        const {vm, target} = makeHeadlessVM();
        await seed(vm, [flag([['repeat', 3, [['move', 10], ['turn', 15]]]])]);
        const before = decompile(target.blocks);
        const oldIds = reachableIds(target.blocks, scriptHatIds(target.blocks)[0]);
        const edited = [flag([['move', 10]])];
        await applyEdit(vm, before, edited);
        oldIds.forEach(id => expect(target.blocks.getBlock(id)).toBeUndefined()); // loop + body gone
        expect(asSet(decompile(target.blocks))).toEqual(asSet(edited));
    });
    test('removing a trailing loop script deletes its substack; sibling survives', async () => {
        const {vm, target} = makeHeadlessVM();
        await seed(vm, [
            {hat: 'when_clicked', body: [['say', 'hi']]},
            flag([['repeat', 3, [['move', 10]]]])
        ]);
        const before = decompile(target.blocks);
        const siblingIds = reachableIds(target.blocks, scriptHatIds(target.blocks)[0]); // say (index 0, kept)
        const removedIds = reachableIds(target.blocks, scriptHatIds(target.blocks)[1]); // repeat (index 1, removed)
        await applyEdit(vm, before, [before[0]]); // drop the trailing repeat
        removedIds.forEach(id => expect(target.blocks.getBlock(id)).toBeUndefined()); // repeat + substack gone
        siblingIds.forEach(id => expect(target.blocks.getBlock(id)).toBeDefined()); // say kept (keep op)
        expect(decompile(target.blocks)).toEqual([before[0]]);
    });
    test('a forever script edit round-trips through applyEdit as a no-op', async () => {
        const {vm, target} = makeHeadlessVM();
        await seed(vm, [flag([['forever', [['move', 10]]]])]);
        const before = decompile(target.blocks);
        const beforeHatId = scriptHatIds(target.blocks)[0];
        await applyEdit(vm, before, [{hat: 'when_flag', body: [['forever', [['move', '10']]]]}]);
        expect(scriptHatIds(target.blocks)[0]).toBe(beforeHatId); // keep, not rebuilt
        expect(decompile(target.blocks)).toEqual(before);
    });
});

describe('scriptFingerprint', () => {
    const s = body => ({hat: 'when_flag', body});
    test('is stable and normalization-invariant (LLM "10" vs 10)', () => {
        expect(scriptFingerprint(s([['move', 10]]))).toBe(scriptFingerprint(s([['move', '10']])));
    });
    test('DIFFERS for scripts with the same hat+first-op but different bodies (the v2 collision)', () => {
        expect(scriptFingerprint(s([['forever', [['turn', 15]]]])))
            .not.toBe(scriptFingerprint(s([['forever', [['move', 10]]]])));
    });
    test('empty/falsy → empty string', () => {
        expect(scriptFingerprint(null)).toBe('');
    });
});

describe('editsToOps (fingerprint-gated, fail-closed)', () => {
    const s = body => ({hat: 'when_flag', body});
    const fp = scriptFingerprint;
    const current = [s([['say', 'Hello']]), s([['forever', [['turn', 15]]]])]; // #1 say, #2 spin

    test('add needs only a script', () => {
        expect(editsToOps([{action: 'add', script: s([['move', 10]])}], current))
            .toEqual([{type: 'add', index: null, script: s([['move', 10]])}]);
    });
    test('modify/remove apply when find matches the referenced script', () => {
        const edits = [
            {action: 'modify', id: 1, find: fp(current[0]), script: s([['say', 'Bye']])},
            {action: 'remove', id: 2, find: fp(current[1])}
        ];
        expect(editsToOps(edits, current)).toEqual([
            {type: 'replace', index: 0, script: s([['say', 'Bye']])},
            {type: 'remove', index: 1}
        ]);
    });
    test('C2 CLOSED: wrong id whose find describes a DIFFERENT script is dropped', () => {
        // two forevers with different bodies — the v2 hole. model means #2 (move) but writes id:1.
        const dup = [s([['forever', [['turn', 15]]]]), s([['forever', [['move', 10]]]])];
        expect(editsToOps([{action: 'remove', id: 1, find: fp(dup[1])}], dup)).toEqual([]);
    });
    test('byte-identical scripts share a fingerprint → removing either is harmless', () => {
        const same = [s([['forever', [['turn', 15]]]]), s([['forever', [['turn', 15]]]])];
        expect(editsToOps([{action: 'remove', id: 1, find: fp(same[0])}], same))
            .toEqual([{type: 'remove', index: 0}]);
    });
    test('drops missing find, out-of-range id, unknown action, add-without-script', () => {
        expect(editsToOps([
            {action: 'remove', id: 2},                                   // no find
            {action: 'modify', id: 1, script: s([])},                    // no find
            {action: 'remove', id: 0, find: fp(current[0])},             // id 0 → idx -1 → dropped
            {action: 'remove', id: 9, find: fp(current[0])},             // out of range (upper)
            {action: 'delete', id: 1, find: fp(current[0])},             // unknown action
            {action: 'add'}                                              // no script
        ], current)).toEqual([]);
    });
    test('non-array edits / null current fail closed to []', () => {
        expect(editsToOps(null, current)).toEqual([]);
        expect(editsToOps([{action: 'remove', id: 1, find: fp(current[0])}], null)).toEqual([]);
    });
});

describe('applyOps (editsToOps-shaped ops against a headless VM)', () => {
    const s = body => ({hat: 'when_flag', body});
    test('add op (index:null) appends without touching the sibling', async () => {
        const {vm, target} = makeHeadlessVM();
        await seed(vm, [s([['say', 'keep']])]);
        const keptIds = reachableIds(target.blocks, scriptHatIds(target.blocks)[0]);
        await applyOps(vm, [{type: 'add', index: null, script: s([['move', 10]])}], target.id);
        keptIds.forEach(id => expect(target.blocks.getBlock(id)).toBeDefined());
        expect(asSet(decompile(target.blocks))).toEqual(asSet([s([['say', 'keep']]), s([['move', 10]])]));
    });
    test('remove op deletes only the indexed hat; sibling survives', async () => {
        const {vm, target} = makeHeadlessVM();
        await seed(vm, [s([['say', 'keep']]), s([['forever', [['turn', 15]]]])]);
        const keptIds = reachableIds(target.blocks, scriptHatIds(target.blocks)[0]);
        const goneIds = reachableIds(target.blocks, scriptHatIds(target.blocks)[1]);
        await applyOps(vm, [{type: 'remove', index: 1}], target.id);
        keptIds.forEach(id => expect(target.blocks.getBlock(id)).toBeDefined());
        goneIds.forEach(id => expect(target.blocks.getBlock(id)).toBeUndefined());
        expect(decompile(target.blocks)).toEqual([s([['say', 'keep']])]);
    });
});
