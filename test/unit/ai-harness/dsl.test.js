import {compile, decompile, scriptHatIds, editableHatIds, isRepresentable, normalizeScript} from '../../../src/lib/ai-harness/dsl';
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

// Raw block arrays for content the DSL cannot represent. compile() can only emit
// OPMAP opcodes, so these are hand-built and planted with the real vm. Declared once
// at module scope; the Task 2 decompile-tolerance and drift-guard tests reuse them.
// NOTE: shareBlocksToTarget runs newBlockIds, which rewrites every id on plant, so the
// literal ids below are gone afterward -- re-derive ids from the vm (scriptHatIds).
const rawIfScript = [
    {id: 'h1', opcode: 'event_whenflagclicked', inputs: {}, fields: {},
        next: 'if1', parent: null, topLevel: true, shadow: false, x: 80, y: 80},
    {id: 'if1', opcode: 'control_if', inputs: {}, fields: {},
        next: null, parent: 'h1', topLevel: false, shadow: false}
];

// when_flag -> repeat(3) { control_if }: the repeat is representable, but its SUBSTACK
// holds an unknown block. Exercises the seqRepresentable recursion (the flat fixtures do not).
const rawSubstackIf = [
    {id: 'hs', opcode: 'event_whenflagclicked', inputs: {}, fields: {},
        next: 'rep', parent: null, topLevel: true, shadow: false, x: 80, y: 80},
    {id: 'rep', opcode: 'control_repeat',
        inputs: {TIMES: {name: 'TIMES', block: 'sht', shadow: 'sht'},
            SUBSTACK: {name: 'SUBSTACK', block: 'cif', shadow: null}},
        fields: {}, next: null, parent: 'hs', topLevel: false, shadow: false},
    {id: 'sht', opcode: 'math_whole_number', inputs: {},
        fields: {NUM: {name: 'NUM', value: '3'}}, next: null, parent: 'rep', shadow: true},
    {id: 'cif', opcode: 'control_if', inputs: {}, fields: {},
        next: null, parent: 'rep', shadow: false}
];

// when_flag -> move, but STEPS holds a reporter (motion_xposition), not a shadow literal.
const rawReporterInput = [
    {id: 'h2', opcode: 'event_whenflagclicked', inputs: {}, fields: {},
        next: 'mv2', parent: null, topLevel: true, shadow: false, x: 80, y: 80},
    {id: 'mv2', opcode: 'motion_movesteps',
        inputs: {STEPS: {name: 'STEPS', block: 'rep2', shadow: 'sh2'}}, fields: {},
        next: null, parent: 'h2', topLevel: false, shadow: false},
    {id: 'sh2', opcode: 'math_number', inputs: {},
        fields: {NUM: {name: 'NUM', value: '10'}}, next: null, parent: 'mv2', shadow: true},
    {id: 'rep2', opcode: 'motion_xposition', inputs: {}, fields: {},
        next: null, parent: 'mv2', shadow: false}
];

describe('isRepresentable', () => {
    test('a fully-supported script is representable', async () => {
        const {vm, target} = makeHeadlessVM();
        await vm.shareBlocksToTarget(compile([flag([['move', 10], ['say', 'hi']])]), target.id);
        const hatId = scriptHatIds(target.blocks)[0];
        expect(isRepresentable(target.blocks, hatId)).toBe(true);
    });
    test('a script containing an unknown opcode is NOT representable', async () => {
        const {vm, target} = makeHeadlessVM();
        await vm.shareBlocksToTarget(rawIfScript, target.id);
        const hatId = scriptHatIds(target.blocks)[0];
        expect(isRepresentable(target.blocks, hatId)).toBe(false);
    });
    test('a supported block with a reporter in a value input is NOT representable', async () => {
        const {vm, target} = makeHeadlessVM();
        await vm.shareBlocksToTarget(rawReporterInput, target.id);
        const hatId = scriptHatIds(target.blocks)[0];
        expect(isRepresentable(target.blocks, hatId)).toBe(false);
    });
    test('an unknown block nested inside a substack is NOT representable (recursion)', async () => {
        const {vm, target} = makeHeadlessVM();
        await vm.shareBlocksToTarget(rawSubstackIf, target.id);
        const hatId = scriptHatIds(target.blocks)[0];
        expect(isRepresentable(target.blocks, hatId)).toBe(false);
    });
});

describe('editableHatIds', () => {
    test('keeps only representable scripts, in order', async () => {
        const {vm, target} = makeHeadlessVM();
        await vm.shareBlocksToTarget(compile([flag([['move', 10]])]), target.id);
        await vm.shareBlocksToTarget(rawIfScript, target.id);
        // scriptHatIds sees BOTH when_flag hats; editableHatIds drops the if one.
        expect(scriptHatIds(target.blocks).length).toBe(2);
        const editable = editableHatIds(target.blocks);
        expect(editable.length).toBe(1);
        expect(isRepresentable(target.blocks, editable[0])).toBe(true);
    });
});

describe('decompile tolerance', () => {
    test('does not throw and returns only representable scripts', async () => {
        const {vm, target} = makeHeadlessVM();
        await vm.shareBlocksToTarget(compile([flag([['move', 10]])]), target.id);
        await vm.shareBlocksToTarget(rawIfScript, target.id); // unknown-body script
        let out;
        expect(() => { out = decompile(target.blocks); }).not.toThrow();
        expect(out).toEqual([flag([['move', 10]])]); // if-script omitted
    });
    test('all-unknown workspace decompiles to []', async () => {
        const {vm, target} = makeHeadlessVM();
        await vm.shareBlocksToTarget(rawIfScript, target.id);
        expect(decompile(target.blocks)).toEqual([]);
    });
});

// Drift guard: the entire safety story rests on the equivalence
//   isRepresentable(hat) === "decompileScript(hat) will not throw".
// seqRepresentable and decompileSequence are two hand-mirrored walks; every other test
// exercises them SEPARATELY. This pins the equivalence so a future OPMAP/decompile change
// can't un-mirror them silently (which would let a false-positive predicate crash decompile
// with nothing green to catch it -- and is why base-hash's catch is NOT truly dead).
describe('isRepresentable matches decompile-safe (drift guard)', () => {
    test('every OPMAP-expressible script is representable AND decompiles cleanly', async () => {
        const {vm, target} = makeHeadlessVM();
        const prog = [flag([
            ['goto', 0, 0], ['set_x', -100], ['say_secs', 'hi', 2], ['wait', 1],
            ['repeat', 3, [['move', 10], ['turn', 15]]],
            ['forever', [['next_costume']]]
        ])];
        await vm.shareBlocksToTarget(compile(prog), target.id);
        for (const id of scriptHatIds(target.blocks)) {
            expect(isRepresentable(target.blocks, id)).toBe(true);
        }
        expect(() => decompile(target.blocks)).not.toThrow();
        expect(decompile(target.blocks)).toEqual(prog); // round-trip holds
    });
    test('unknown-opcode and reporter-input scripts are rejected by the predicate', async () => {
        const {vm, target} = makeHeadlessVM();
        await vm.shareBlocksToTarget(rawIfScript, target.id);
        await vm.shareBlocksToTarget(rawReporterInput, target.id);
        for (const id of scriptHatIds(target.blocks)) {
            expect(isRepresentable(target.blocks, id)).toBe(false);
        }
    });
});
