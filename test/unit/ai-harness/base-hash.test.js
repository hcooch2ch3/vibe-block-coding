import {hashProgram, targetMatchesBase} from '../../../src/lib/ai-harness/base-hash';
import {makeHeadlessVM} from './headless-target';

const A = [{hat: 'when_clicked', body: [['move', 10]]}];
const B = [{hat: 'when_clicked', body: [['move', 10]]}, {hat: 'when_clicked', body: [['turn', 15]]}];

test('hashProgram is stable and order-sensitive', () => {
    expect(hashProgram(A)).toBe(hashProgram([{hat: 'when_clicked', body: [['move', 10]]}]));
    expect(hashProgram(A)).not.toBe(hashProgram(B));
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
