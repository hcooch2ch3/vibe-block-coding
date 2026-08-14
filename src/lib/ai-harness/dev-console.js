/**
 * AI harness: dev console hooks + reusable generate/edit glue.
 *
 * generate/edit are thin wrappers that run "speech → blocks" and "speech → edit"
 * over the vm in one shot. They just wire llm.requestScripts → dsl.compile/decompile
 * → edit.applyEdit; the logic lives in each module. The live smoke test (console)
 * and the week-2 UI both call these same functions.
 *
 * installDevConsole exposes these functions as window.vibe in dev builds.
 */

import {requestScripts, requestTurn, DEFAULT_MODEL} from './llm';
import {compile, decompile, editableHatIds} from './dsl';
import {applyEdit, applyOps, editsToOps} from './edit';
import {hashProgram, targetMatchesBase} from './base-hash';

/**
 * Build new blocks from a natural-language instruction, plant them in the current
 * edit target, and return the resulting DSL.
 * @param {VirtualMachine} vm - plants blocks into editingTarget
 * @param {object} opts - {apiKey, instruction, model?, targetId?}
 * @param {Function} fetchImpl - injectable fetch (omit to use global fetch)
 * @returns {Promise<Array<object>>} DSL script array decompiled after planting
 */
export const generate = async function (vm, opts, fetchImpl) {
    const target = opts.targetId ? vm.runtime.getTargetById(opts.targetId) : vm.editingTarget;
    if (!target) throw new Error('generate: pinned target no longer exists');
    const scripts = await requestScripts(
        {apiKey: opts.apiKey, model: opts.model, instruction: opts.instruction},
        fetchImpl
    );
    await vm.shareBlocksToTarget(compile(scripts), target.id);
    vm.refreshWorkspace();
    return decompile(target.blocks);
};

/**
 * Show the current program to the LLM, edit it from a natural-language instruction,
 * then inject only the changed parts.
 * @param {VirtualMachine} vm - edits editingTarget
 * @param {object} opts - {apiKey, instruction, model?, targetId?}
 * @param {Function} fetchImpl - injectable fetch (omit to use global fetch)
 * @returns {Promise<Array<object>>} DSL script array decompiled after the edit
 */
export const edit = async function (vm, opts, fetchImpl) {
    const target = opts.targetId ? vm.runtime.getTargetById(opts.targetId) : vm.editingTarget;
    if (!target) throw new Error('edit: pinned target no longer exists');
    const current = decompile(target.blocks);
    const scripts = await requestScripts(
        {
            apiKey: opts.apiKey,
            model: opts.model,
            instruction: opts.instruction,
            currentScripts: current
        },
        fetchImpl
    );
    await applyEdit(vm, current, scripts, target.id);
    return decompile(target.blocks);
};

/**
 * Dev-only gate helper: run build prompts through the ENVELOPE path (requestTurn)
 * and report how many produced >=1 block. Measures what actually ships (the unified
 * chat), used to decide auto-classify vs an explicit Build/Ask fallback
 * (spec "Validation gate", 80% threshold).
 * @param {VirtualMachine} vm - vm instance (kept for signature stability; unused internally)
 * @param {object} opts - {apiKey, prompts, model?}
 * @param {Function} [fetchImpl] - injectable fetch (omit to use global fetch)
 * @returns {Promise<object>} object with total, produced, and rate fields
 */
export const measureBuildRate = async function (vm, {apiKey, prompts, model}, fetchImpl) {
    if (!Array.isArray(prompts)) throw new TypeError('measureBuildRate: prompts must be an array');
    let produced = 0;
    for (const instruction of prompts) {
        try {
            const out = await requestTurn({apiKey, model, instruction}, fetchImpl);
            if (out.edits && out.edits.length) produced++;
        } catch (e) {
            // eslint-disable-next-line no-console
            console.warn('[vibe.measure] prompt failed:', instruction, e.message);
        }
    }
    return {total: prompts.length, produced, rate: prompts.length ? produced / prompts.length : 0};
};

// DSL action → the op type editsToOps produces for it.
const OP_FOR_ACTION = {add: 'add', modify: 'replace', remove: 'remove'};

/**
 * Dev-only eval: run labeled edit cases through requestTurn, then score each case
 * against the ACTUAL production resolver, editsToOps, not a lookalike proxy. A
 * case is compliant iff the model's reply resolves to exactly ONE op, of the
 * expected type, targeting the expected script. Because scoring runs the real
 * editsToOps (id-based selection + exact-find gate), it inherits production's
 * behavior by construction: a wrong-id/right-find edit is dropped (scores 0), a
 * substring find is dropped (scores 0), and a correct edit bundled with spurious
 * or full-program-resend edits yields >1 op (scores 0). Those are the lenient
 * failure modes a `.some()` scorer would wave through.
 *
 * This is the load-bearing check on the "model follows the protocol" assumption
 * (an under-compliant model silently drops the child's edits). It needs a real key.
 * Run it MANUALLY before shipping edit UI with a ~12-case labeled corpus; target
 * rate ≥ 0.8 (the project's validation-gate precedent). Nothing in CI runs it.
 *
 * @param {VirtualMachine} vm - unused; kept for window.vibe signature parity
 * @param {object} opts - {apiKey, cases, model?} where each case is
 *   {instruction, currentScripts, expect:{action, findIndex?}} (findIndex is the
 *   0-based index of the script a modify/remove should target)
 * @param {Function} [fetchImpl] - injectable fetch (omit to use global fetch)
 * @returns {Promise<object>} object with total, correct, and rate fields
 */
export const measureEditQuality = async function (vm, {apiKey, cases, model}, fetchImpl) {
    if (!Array.isArray(cases)) throw new TypeError('measureEditQuality: cases must be an array');
    let correct = 0;
    for (const c of cases) {
        try {
            const {edits} = await requestTurn(
                {apiKey, model, instruction: c.instruction, currentScripts: c.currentScripts}, fetchImpl);
            const ops = editsToOps(edits || [], c.currentScripts); // the real production path
            const want = c.expect;
            let ok = ops.length === 1 && ops[0].type === OP_FOR_ACTION[want.action];
            if (ok && typeof want.findIndex !== 'undefined') ok = ops[0].index === want.findIndex;
            if (ok) correct++;
        } catch (e) {
            // eslint-disable-next-line no-console
            console.warn('[vibe.evalEdits] case failed:', c.instruction, e.message);
        }
    }
    return {total: cases.length, correct, rate: cases.length ? correct / cases.length : 0};
};

/**
 * Compile the current target's program and ask the LLM to respond, but do NOT
 * mutate the workspace. Returns {answer} on a text-only reply, or
 * {answer, proposal} when the model returns applicable edits. The proposal
 * carries a baseStamp so applyProposal can detect stale edits before injecting.
 *
 * The model returns id+find edits (add/modify/remove); editsToOps resolves them
 * to ops against `current`, dropping any whose find does not match the targeted
 * script (fail-closed). An empty program just yields add ops. No valid ops → {answer}.
 *
 * @param {VirtualMachine} vm - scratch-vm instance
 * @param {object} opts - {apiKey, instruction, model?, targetId, history?}
 * @param {Function} [fetchImpl] - injectable fetch (omit to use global fetch)
 * @returns {Promise<object>} object with optional answer string and optional proposal object
 */
export const propose = async function (vm, opts, fetchImpl) {
    const target = vm.runtime.getTargetById(opts.targetId);
    if (!target) throw new Error('propose: pinned target no longer exists');
    const current = decompile(target.blocks); // propose NEVER mutates / stops threads
    const isEmpty = current.length === 0;
    const cfg = {
        apiKey: opts.apiKey,
        model: opts.model,
        instruction: opts.instruction,
        history: opts.history,
        endpoint: opts.endpoint,
        headers: opts.headers
    };
    if (!isEmpty) cfg.currentScripts = current;
    const {answer, edits} = await requestTurn(cfg, fetchImpl);
    // editsToOps drops any modify/remove whose find != scriptFingerprint(current[id-1]),
    // so a wrong id becomes a no-op instead of a destructive edit. No valid ops → answer only.
    const ops = editsToOps(edits || [], current);
    if (!ops.length) return {answer};
    const baseStamp = {targetId: opts.targetId, baseHash: hashProgram(current)};
    return {answer, proposal: {kind: 'edit', baseStamp, ops}};
};

/**
 * Apply a proposal returned by propose(). Re-checks the target's current program
 * against the baseStamp captured at propose time. If the workspace was edited in
 * the meantime (stale), returns {ok:false, stale:true} with no side-effects.
 *
 * Only after the stale guard passes does it stop running threads (misc(a): stop
 * threads at Apply, not at propose, so we don't interrupt a running project just
 * because the user clicked Preview).
 *
 * NON-ATOMIC: applyOps deletes then re-injects the changed scripts with no
 * rollback. A rejection mid-apply may leave the workspace partially edited; the
 * caller MUST treat a thrown error as "workspace possibly dirty → Rebuild", not
 * a no-op.
 *
 * @param {VirtualMachine} vm - scratch-vm instance
 * @param {object} proposal - {kind:'edit', baseStamp, ops}
 * @returns {Promise<object>} {ok:false, stale:true} when stale; otherwise
 *   {ok:true, changedTopIds} where changedTopIds are the vm hat ids this apply
 *   added or replaced (empty for a keep-only edit). Used for the canvas glow.
 */
export const applyProposal = async function (vm, proposal) {
    const {targetId, baseHash} = proposal.baseStamp;
    // Fail-closed for a proposal persisted before this upgrade (has no ops).
    if (!Array.isArray(proposal.ops)) return {ok: false, stale: true};
    if (!targetMatchesBase(vm, targetId, baseHash)) return {ok: false, stale: true};
    // misc(a): stop threads ONLY here, at Apply. propose must not touch the running
    // project. applyOps' deleteBlock can orphan a running script otherwise.
    vm.stopAll();
    // Recover the REAL post-injection hat ids. shareBlocksToTarget runs newBlockIds
    // on a deep clone, so compile-time ids are discarded; the only ids that reach
    // the workspace are the vm's. Snapshot before, diff after: added + replaced hats
    // are present after but not before; kept hats keep their id; removed hats vanish.
    const target = vm.runtime.getTargetById(targetId);
    const before = new Set(editableHatIds(target.blocks));
    await applyOps(vm, proposal.ops, targetId);
    const changedTopIds = editableHatIds(target.blocks).filter(id => !before.has(id));
    return {ok: true, changedTopIds};
};

/**
 * Dev builds only: expose the pipeline as window.vibe. From the browser console,
 * `await vibe.smoke('sk-ant-...')` verifies the generate → edit loop against the real API.
 * @param {VirtualMachine} vm - current vm instance
 * @returns {void}
 */
export const installDevConsole = function (vm) {
    if (typeof window === 'undefined') return;
    window.vibe = {
        requestScripts,
        compile,
        decompile,
        applyEdit,
        DEFAULT_MODEL,
        generate: (apiKey, instruction, model) =>
            generate(vm, {apiKey, instruction, model}),
        edit: (apiKey, instruction, model) =>
            edit(vm, {apiKey, instruction, model}),
        measure: (apiKey, prompts, model) =>
            measureBuildRate(vm, {apiKey, prompts, model}),
        evalEdits: (apiKey, cases, model) =>
            measureEditQuality(vm, {apiKey, cases, model}),
        // Live smoke test: one generate, one edit. Logs the before/after DSL.
        smoke: async (apiKey, model) => {
            const before = await generate(
                vm, {apiKey, model, instruction: 'make the cat walk and turn'});
            // eslint-disable-next-line no-console
            console.log('[vibe] generated:', JSON.stringify(before));
            const after = await edit(
                vm, {apiKey, model, instruction: 'also say hello when it starts'});
            // eslint-disable-next-line no-console
            console.log('[vibe] edited:', JSON.stringify(after));
            return {before, after};
        }
    };
};
