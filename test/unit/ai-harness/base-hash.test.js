import {hashProgram, targetMatchesBase} from '../../../src/lib/ai-harness/base-hash';
import {makeHeadlessVM} from './headless-target';

const A = [{hat: 'when_clicked', body: [['move', 10]]}];
const B = [{hat: 'when_clicked', body: [['move', 10]]}, {hat: 'when_clicked', body: [['turn', 15]]}];

test('hashProgram is stable and order-sensitive', () => {
    expect(hashProgram(A)).toBe(hashProgram([{hat: 'when_clicked', body: [['move', 10]]}]));
    expect(hashProgram(A)).not.toBe(hashProgram(B));
    // Boundary: empty scripts array produces a stable sentinel the true-case test relies on.
    expect(hashProgram([])).toBe('[]');
});

test('targetMatchesBase: true when the live target still equals the base', () => {
    // makeHeadlessVM gives a real EMPTY target → decompile(target.blocks) === []
    const {vm, target} = makeHeadlessVM();
    expect(targetMatchesBase(vm, target.id, hashProgram([]))).toBe(true);
});

test('targetMatchesBase: false when the base differs from the live (empty) program', () => {
    const {vm, target} = makeHeadlessVM();
    expect(targetMatchesBase(vm, target.id, hashProgram(A))).toBe(false);
});

test('targetMatchesBase: false when the target is gone (fail-closed → Rebuild)', () => {
    const {vm} = makeHeadlessVM();
    expect(targetMatchesBase(vm, 'no-such-target', hashProgram([]))).toBe(false);
});

test('targetMatchesBase: an inert (non-OPMAP) script is invisible to stale detection', () => {
    const {vm, target} = makeHeadlessVM();
    // Known hat (event_whenthisspriteclicked = "when_clicked") with an UNKNOWN body block.
    // decompile now SKIPS this whole script (non-representable) instead of throwing, so the
    // editable program is [] -- an inert-only workspace hashes equal to an empty base. This is
    // safe: apply only ever targets representable scripts by editable index, so an unchanged
    // editable program (empty here) genuinely means "nothing to conflict with". (Documented
    // as the "stale detection on inert-only changes" known limitation.)
    target.blocks.createBlock({
        id: 'hat1', opcode: 'event_whenthisspriteclicked',
        next: 'alien1', parent: null, inputs: {}, fields: {},
        topLevel: true, shadow: false, x: 0, y: 0
    });
    target.blocks.createBlock({
        id: 'alien1', opcode: 'sound_play', // not in OPMAP → decompiled away, not thrown on
        next: null, parent: 'hat1', inputs: {}, fields: {},
        topLevel: false, shadow: false
    });
    // No throw (the try/catch survives as defense-in-depth for truly corrupt state), and the
    // editable program is [] → matches an empty base because the inert script is invisible.
    expect(() => targetMatchesBase(vm, target.id, hashProgram([]))).not.toThrow();
    expect(targetMatchesBase(vm, target.id, hashProgram([]))).toBe(true);
    // NOT vacuously true: a non-empty base still fails to match the empty editable program.
    expect(targetMatchesBase(vm, target.id, hashProgram(A))).toBe(false);
});
