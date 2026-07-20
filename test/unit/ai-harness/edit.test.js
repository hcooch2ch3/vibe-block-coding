import {diff, applyEdit} from '../../../src/lib/ai-harness/edit';
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
});

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
