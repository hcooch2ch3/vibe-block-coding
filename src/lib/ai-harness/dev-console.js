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
import {compile, decompile} from './dsl';
import {applyEdit} from './edit';
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
 * @returns {Promise<{total:number, produced:number, rate:number}>}
 */
export const measureBuildRate = async function (vm, {apiKey, prompts, model}, fetchImpl) {
    if (!Array.isArray(prompts)) throw new TypeError('measureBuildRate: prompts must be an array');
    let produced = 0;
    for (const instruction of prompts) {
        try {
            const out = await requestTurn({apiKey, model, instruction}, fetchImpl);
            if (out.blocks && out.blocks.length) produced++;
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
 * {answer, proposal} when the model returns blocks. The proposal carries a
 * baseStamp so applyProposal can detect stale edits before injecting.
 *
 * generate vs edit is chosen by whether the target is currently empty:
 *   - empty  → kind:'generate', blocks from LLM
 *   - non-empty → kind:'edit', oldScripts/newScripts from LLM
 *
 * @param {VirtualMachine} vm
 * @param {object} opts - {apiKey, instruction, model?, targetId, history?}
 * @param {Function} [fetchImpl] - injectable fetch (omit to use global fetch)
 * @returns {Promise<{answer?: string, proposal?: object}>}
 */
export const propose = async function (vm, opts, fetchImpl) {
    const target = vm.runtime.getTargetById(opts.targetId);
    if (!target) throw new Error('propose: pinned target no longer exists');
    const current = decompile(target.blocks); // propose NEVER mutates / stops threads
    const isEmpty = current.length === 0;
    const {answer, blocks} = await requestTurn({
        apiKey: opts.apiKey, model: opts.model, instruction: opts.instruction,
        currentScripts: isEmpty ? undefined : current, history: opts.history
    }, fetchImpl);
    if (!blocks) return {answer};
    const baseStamp = {targetId: opts.targetId, baseHash: hashProgram(current)};
    const proposal = isEmpty ?
        {kind: 'generate', blocks, baseStamp} :
        {kind: 'edit', oldScripts: current, newScripts: blocks, baseStamp};
    return {answer, proposal};
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
 * @param {VirtualMachine} vm
 * @param {object} proposal - {kind, blocks|oldScripts+newScripts, baseStamp}
 * @returns {Promise<{ok:boolean, stale?:boolean}>}
 */
export const applyProposal = async function (vm, proposal) {
    const {targetId, baseHash} = proposal.baseStamp;
    if (!targetMatchesBase(vm, targetId, baseHash)) return {ok: false, stale: true};
    // misc(a): stop threads ONLY here, at Apply — propose must not touch the running
    // project. applyEdit's deleteBlock can orphan a running script otherwise.
    vm.stopAll();
    if (proposal.kind === 'generate') {
        await vm.shareBlocksToTarget(compile(proposal.blocks), targetId);
        vm.refreshWorkspace();
    } else {
        await applyEdit(vm, proposal.oldScripts, proposal.newScripts, targetId);
    }
    return {ok: true};
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
