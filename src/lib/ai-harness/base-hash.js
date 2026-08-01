import {decompile} from './dsl';

/**
 * Stable string hash of a decompiled DSL script array.
 *
 * JSON.stringify of decompile() output is canonical because decompile emits a
 * deterministic, OPMAP-only, position-free shape (verified round-trip identity,
 * design.md §4). The "hash" name keeps the option open to shorten later.
 *
 * @param {Array} scripts - decompiled DSL script array (output of decompile())
 * @returns {string} stable canonical hash string
 */
export const hashProgram = function (scripts) {
    if (!Array.isArray(scripts)) throw new TypeError('hashProgram: expected a decompiled scripts array');
    return JSON.stringify(scripts);
};

/**
 * Returns true iff the live target's decompiled program still equals the base
 * hash captured at propose time. Returns false (fail-closed → Rebuild) if the
 * target no longer exists in the runtime.
 *
 * @param {object} vm - scratch-vm instance
 * @param {string} targetId - id of the target to check
 * @param {string} baseHash - hash produced by hashProgram() at propose time
 * @returns {boolean}
 */
export const targetMatchesBase = function (vm, targetId, baseHash) {
    const target = vm.runtime.getTargetById(targetId);
    if (!target) return false;
    try {
        return hashProgram(decompile(target.blocks)) === baseHash;
    } catch (e) {
        // Unknown opcode / corrupt blocks → treat as edited → stale → Rebuild (fail-closed).
        return false;
    }
};
