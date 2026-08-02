/**
 * AI 하니스 — dev 콘솔 훅 + 재사용 가능한 generate/edit 글루.
 *
 * generate/edit 는 "말 → 블록" 과 "말 → 편집" 을 vm 위에서 한 번에 굴리는 얇은
 * 래퍼다. llm.requestScripts → dsl.compile/decompile → edit.applyEdit 를 엮을 뿐,
 * 로직은 각 모듈에 있다. 라이브 스모크(콘솔)와 2주차 UI 가 같은 함수를 쓴다.
 *
 * installDevConsole 은 dev 빌드에서 window.vibe 로 이 함수들을 노출한다.
 */

import {requestScripts, requestTurn, DEFAULT_MODEL} from './llm';
import {compile, decompile, scriptHatIds} from './dsl';
import {applyEdit, applyOps, editsToOps} from './edit';
import {hashProgram, targetMatchesBase} from './base-hash';

/**
 * 자연어 지시로 블록을 새로 만들어 현재 편집 대상에 심고, 결과 DSL 을 돌려준다.
 * @param {VirtualMachine} vm - editingTarget 에 블록을 심음
 * @param {object} opts - {apiKey, instruction, model?, targetId?}
 * @param {Function} fetchImpl - 주입용 fetch (생략 시 전역 fetch)
 * @returns {Promise<Array<object>>} 심은 뒤 decompile 한 DSL 스크립트 배열
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
 * 현재 프로그램을 LLM 에게 보여주고 자연어 지시로 수정한 뒤 변경분만 주입한다.
 * @param {VirtualMachine} vm - editingTarget 을 수정
 * @param {object} opts - {apiKey, instruction, model?, targetId?}
 * @param {Function} fetchImpl - 주입용 fetch (생략 시 전역 fetch)
 * @returns {Promise<Array<object>>} 수정 뒤 decompile 한 DSL 스크립트 배열
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

/**
 * Compile the current target's program and ask the LLM to respond — but do NOT
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
        history: opts.history
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
 *   added or replaced (empty for a keep-only edit) — for the canvas glow.
 */
export const applyProposal = async function (vm, proposal) {
    const {targetId, baseHash} = proposal.baseStamp;
    // Fail-closed for a proposal persisted before this upgrade (has no ops).
    if (!Array.isArray(proposal.ops)) return {ok: false, stale: true};
    if (!targetMatchesBase(vm, targetId, baseHash)) return {ok: false, stale: true};
    // misc(a): stop threads ONLY here, at Apply — propose must not touch the running
    // project. applyOps' deleteBlock can orphan a running script otherwise.
    vm.stopAll();
    // Recover the REAL post-injection hat ids. shareBlocksToTarget runs newBlockIds
    // on a deep clone, so compile-time ids are discarded — the only ids that reach
    // the workspace are the vm's. Snapshot before, diff after: added + replaced hats
    // are present after but not before; kept hats keep their id; removed hats vanish.
    const target = vm.runtime.getTargetById(targetId);
    const before = new Set(scriptHatIds(target.blocks));
    await applyOps(vm, proposal.ops, targetId);
    const changedTopIds = scriptHatIds(target.blocks).filter(id => !before.has(id));
    return {ok: true, changedTopIds};
};

/**
 * dev 빌드 전용: window.vibe 로 파이프라인을 노출한다. 브라우저 콘솔에서
 * `await vibe.smoke('sk-ant-...')` 로 생성→편집 루프를 실제 API 로 검증할 수 있다.
 * @param {VirtualMachine} vm - 현재 vm 인스턴스
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
        // 라이브 스모크: 생성 한 번, 편집 한 번. before/after DSL 을 로그로 남긴다.
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
