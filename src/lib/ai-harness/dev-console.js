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
    let produced = 0;
    for (const instruction of prompts) {
        try {
            const out = await requestTurn({apiKey, model, instruction}, fetchImpl);
            if (out.blocks && out.blocks.length) produced++;
        } catch (e) { /* count as not produced */ }
    }
    return {total: prompts.length, produced, rate: prompts.length ? produced / prompts.length : 0};
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
