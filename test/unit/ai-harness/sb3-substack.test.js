import {compile, decompile} from '../../../src/lib/ai-harness/dsl';
import {makeHeadlessVM} from './headless-target';
import sb3 from 'scratch-vm/src/serialization/sb3';

const flag = body => ({hat: 'when_flag', body});

// Seed a program, serialize the whole project, deserialize into a runtime, and
// return the reloaded non-stage sprite. Read it from deserialize's RETURNED
// targets (they already carry their blocks) — NOT from runtime.targets, which
// still holds makeHeadlessVM's pre-seeded blank sprite. installTargets is
// skipped: it only adds/sorts/renames targets, it does not mutate block data.
const reload = async prog => {
    const {vm, target} = makeHeadlessVM();
    await vm.shareBlocksToTarget(compile(prog), target.id);
    const json = sb3.serialize(vm.runtime); // {targets, monitors, extensions, meta}
    const {vm: vm2} = makeHeadlessVM();
    const {targets} = await sb3.deserialize(
        JSON.parse(JSON.stringify(json)), vm2.runtime);
    const reloaded = targets.find(t => !t.isStage);
    expect(reloaded).toBeDefined();
    return reloaded;
};

describe('sb3 serialize/deserialize preserves programs', () => {
    test('flat-only baseline survives a project round-trip (harness sanity)', async () => {
        const prog = [flag([['move', 10], ['say', 'hi']])];
        expect(decompile((await reload(prog)).blocks)).toEqual(prog);
    });
    test('repeat + forever survive a project round-trip', async () => {
        const prog = [
            flag([['repeat', 3, [['move', 10]]]]),
            {hat: 'when_clicked', body: [['forever', [['turn', 15]]]]}
        ];
        expect(decompile((await reload(prog)).blocks)).toEqual(prog);
    });
    test('an empty substack survives a project round-trip', async () => {
        const prog = [flag([['forever', []]])];
        expect(decompile((await reload(prog)).blocks)).toEqual(prog);
    });
    test('reloaded SUBSTACK inputs keep shadow === null (not undefined)', async () => {
        // The original corruption worry: newBlockIds turns shadow:null -> undefined,
        // which sb3 would serialize as an obscured shadow. Assert the round-trip
        // recovers shadow === null exactly — decompile alone reads only .block and
        // would not catch a corrupted shadow tag.
        const reloaded = await reload([
            flag([['repeat', 3, [['move', 10]]]]),
            {hat: 'when_clicked', body: [['forever', [['turn', 15]]]]}
        ]);
        const cBlocks = Object.keys(reloaded.blocks._blocks)
            .map(id => reloaded.blocks._blocks[id])
            .filter(b => b.opcode === 'control_repeat' || b.opcode === 'control_forever');
        expect(cBlocks.length).toBe(2);
        cBlocks.forEach(b => {
            expect(b.inputs.SUBSTACK).toBeDefined();
            expect(b.inputs.SUBSTACK.shadow).toBe(null);
        });
    });
});
