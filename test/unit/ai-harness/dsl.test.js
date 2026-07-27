import {compile, decompile, scriptHatIds} from '../../../src/lib/ai-harness/dsl';
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
