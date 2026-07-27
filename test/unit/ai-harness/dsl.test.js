import {compile, decompile, scriptHatIds, normalizeScript} from '../../../src/lib/ai-harness/dsl';
import {makeHeadlessVM} from './headless-target';

const flag = body => ({hat: 'when_flag', body});

async function seed (vm, scripts) {
    await vm.shareBlocksToTarget(compile(scripts), vm.editingTarget.id);
}

describe('dsl compile/decompile round-trip (headless real scratch-vm)', () => {
    test('a single motion+looks script survives round-trip', async () => {
        const {vm, target} = makeHeadlessVM();
        const prog = [flag([['move', 10], ['turn', 15], ['say', 'hi']])];
        await seed(vm, prog);
        expect(decompile(target.blocks)).toEqual(prog);
    });

    test('round-trip preserves Korean text and negative numbers', async () => {
        const {vm, target} = makeHeadlessVM();
        const prog = [flag([['say', '안녕'], ['move', -20]])];
        await seed(vm, prog);
        expect(decompile(target.blocks)).toEqual(prog);
    });

    test('multiple scripts survive round-trip in order', async () => {
        const {vm, target} = makeHeadlessVM();
        const prog = [flag([['move', 10]]), flag([['say', 'a']])];
        await seed(vm, prog);
        expect(decompile(target.blocks)).toEqual(prog);
    });
});

describe('scriptHatIds', () => {
    test('returns one id per top-level hat, in decompile order', async () => {
        const {vm, target} = makeHeadlessVM();
        await seed(vm, [flag([['move', 10]]), flag([['say', 'a']])]);
        const ids = scriptHatIds(target.blocks);
        expect(ids.length).toBe(2);
        // each id must be a hat block, and align with decompile order
        const scripts = decompile(target.blocks);
        ids.forEach((id, i) => {
            expect(target.blocks.getBlock(id).opcode).toBe('event_whenflagclicked');
            expect(decompile(target.blocks)[i]).toEqual(scripts[i]);
        });
    });
});

describe('Tier A flat opcode additions', () => {
    test('multi-input and no-input flat blocks round-trip', async () => {
        const {vm, target} = makeHeadlessVM();
        const prog = [flag([
            ['goto', 0, 0], ['set_x', -100], ['change_x', 5], ['change_y', 20], ['set_y', -50],
            ['think', 'hmm'], ['think_secs', 'hmm', 3], ['say_secs', 'hi', 2],
            ['set_size', 150], ['change_size', -10], ['show'], ['hide'], ['next_costume'], ['wait', 1]
        ])];
        await seed(vm, prog);
        expect(decompile(target.blocks)).toEqual(prog);
    });
    test('when_clicked is a supported hat', async () => {
        const {vm, target} = makeHeadlessVM();
        const prog = [{hat: 'when_clicked', body: [['move', 10]]}];
        await seed(vm, prog);
        expect(decompile(target.blocks)).toEqual(prog);
    });
});

describe('Tier B substacks (repeat/forever)', () => {
    test('repeat with a body round-trips', async () => {
        const {vm, target} = makeHeadlessVM();
        const prog = [flag([['repeat', 3, [['move', 10], ['turn', 15]]]])];
        await seed(vm, prog);
        expect(decompile(target.blocks)).toEqual(prog);
    });
    test('forever with a body round-trips', async () => {
        const {vm, target} = makeHeadlessVM();
        const prog = [flag([['forever', [['move', 10]]]])];
        await seed(vm, prog);
        expect(decompile(target.blocks)).toEqual(prog);
    });
    test('nested substacks round-trip', async () => {
        const {vm, target} = makeHeadlessVM();
        const prog = [flag([['forever', [['repeat', 2, [['move', 10]]]]]])];
        await seed(vm, prog);
        expect(decompile(target.blocks)).toEqual(prog);
    });
    test('empty substack round-trips as []', async () => {
        const {vm, target} = makeHeadlessVM();
        const prog = [flag([['forever', []]])];
        await seed(vm, prog);
        expect(decompile(target.blocks)).toEqual(prog);
    });
    test('a step can follow repeat (repeat is not a cap block)', async () => {
        const {vm, target} = makeHeadlessVM();
        const prog = [flag([['repeat', 2, [['move', 10]]], ['say', 'done']])];
        await seed(vm, prog);
        expect(decompile(target.blocks)).toEqual(prog);
    });
    test('a numeric-looking text message stays a string (text shadow not coerced)', async () => {
        const {vm, target} = makeHeadlessVM();
        const prog = [flag([['say', '5'], ['say_secs', '7', 2]])];
        await seed(vm, prog);
        expect(decompile(target.blocks)).toEqual(prog);
    });
    test('normalizeScript recurses: string vs number inside a loop compare equal', () => {
        const a = {hat: 'when_flag', body: [['repeat', '3', [['move', '10']]]]};
        const b = {hat: 'when_flag', body: [['repeat', 3, [['move', 10]]]]};
        expect(JSON.stringify(normalizeScript(a))).toBe(JSON.stringify(normalizeScript(b)));
    });
    test('normalizeScript keeps text args as strings (numeric-equal text stays distinct)', () => {
        const a = normalizeScript({hat: 'when_flag', body: [['say', '5']]});
        const b = normalizeScript({hat: 'when_flag', body: [['say', '05']]});
        expect(a.body[0]).toEqual(['say', '5']); // not coerced to number 5
        expect(JSON.stringify(a)).not.toBe(JSON.stringify(b)); // a text edit is not a no-op
    });
});
