/**
 * AI 하니스 — 편집(diff/apply).
 *
 * 양방향 편집 루프의 신규성 절반: 현재 프로그램을 DSL로 역변환해 LLM에게 수정을
 * 맡긴 뒤, 옛 DSL과 새 DSL을 비교해 **바뀐 스크립트만** 블록으로 다시 심는다.
 * 손대지 않은 스크립트는 vm 안에서 그대로 살아남는다(= 진짜 "기존 보존").
 *
 *   diff:      옛 DSL[] vs 새 DSL[] → per-script 연산 목록 (순수 함수, 테스트 용이)
 *   applyEdit: 그 연산을 scratch-vm 대상에 적용 (변경분만 주입)
 *
 * MVP 세분성 = per-script 통째 재구성. 스크립트 하나 안에서 블록 하나만 바뀌어도
 * 그 스크립트는 통째로 다시 컴파일된다(element-level splice는 후속 과제). 매칭은
 * 배열 위치(index) 기반 — 재정렬/중복 hat 은 "전부 바뀜"으로 degrade 한다.
 */

import {compileScript, scriptHatIds} from './dsl';

// 두 DSL 스크립트가 의미상 같은지(hat + body 전체) 깊은 비교.
const sameScript = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * 옛/새 DSL 스크립트 배열을 위치 기반으로 비교해 연산 목록을 만든다.
 * @param {Array<object>} oldScripts - decompile(현재 블록) 결과
 * @param {Array<object>} newScripts - LLM 이 돌려준 수정본
 * @returns {Array<object>} keep | replace | add | remove 연산 목록
 */
export const diff = function (oldScripts, newScripts) {
    const ops = [];
    const overlap = Math.min(oldScripts.length, newScripts.length);
    for (let i = 0; i < overlap; i++) {
        if (sameScript(oldScripts[i], newScripts[i])) {
            ops.push({type: 'keep', index: i});
        } else {
            ops.push({type: 'replace', index: i, script: newScripts[i]});
        }
    }
    for (let i = overlap; i < newScripts.length; i++) {
        ops.push({type: 'add', index: i, script: newScripts[i]});
    }
    for (let i = overlap; i < oldScripts.length; i++) {
        ops.push({type: 'remove', index: i});
    }
    return ops;
};

// 컴파일된 블록 배열에서 top-level 블록의 좌표를 지정 위치로 옮긴다(재구성 시 위치 보존).
const placeAt = function (compiled, x, y) {
    const top = compiled.find(b => b.topLevel);
    if (top) {
        top.x = x;
        top.y = y;
    }
    return compiled;
};

/**
 * diff 연산을 실제 scratch-vm 편집 대상에 적용한다. 바뀐 스크립트만 건드리고,
 * keep 스크립트의 블록은 vm 안에서 그대로 살아남는다.
 *
 * 주의: 프로젝트가 실행 중이면 먼저 멈추고 호출할 것(deleteBlock 은 도는 스레드를
 * 정리하지 않음 — scratch-vm 의 @todo).
 *
 * @param {VirtualMachine} vm - editingTarget 에 편집을 적용
 * @param {Array<object>} oldScripts - 편집 전 DSL (decompile(현재 블록) 결과)
 * @param {Array<object>} newScripts - LLM 이 돌려준 수정본 DSL
 * @returns {Promise<Array>} 적용한 연산 목록(diff 결과)
 */
export const applyEdit = async function (vm, oldScripts, newScripts) {
    const target = vm.editingTarget;
    const blocks = target.blocks;
    const ops = diff(oldScripts, newScripts);
    // oldScripts 와 인덱스가 일치하는 hat id 스냅샷 — 삭제로 순서가 흔들려도 id 로 짚는다.
    const hatIds = scriptHatIds(blocks);

    // 옮겨 심을 새 스크립트들을 먼저 컴파일(삭제 전에 옛 좌표를 읽어 보존).
    const toShare = [];
    for (const op of ops) {
        if (op.type === 'keep') continue;
        if (op.type === 'add') {
            toShare.push(compileScript(op.script));
        } else if (op.type === 'replace') {
            const oldHat = blocks.getBlock(hatIds[op.index]);
            toShare.push(placeAt(compileScript(op.script), oldHat.x, oldHat.y));
        }
    }

    // 바뀐/사라진 옛 스크립트 삭제(hat 삭제 → next 재귀로 스택 통째 정리).
    for (const op of ops) {
        if (op.type === 'replace' || op.type === 'remove') {
            blocks.deleteBlock(hatIds[op.index]);
        }
    }

    // 새/수정 스크립트 주입.
    for (const compiled of toShare) {
        await vm.shareBlocksToTarget(compiled, target.id);
    }

    vm.refreshWorkspace();
    return ops;
};
