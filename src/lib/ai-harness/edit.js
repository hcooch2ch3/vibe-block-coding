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

import {compileScript, scriptHatIds, normalizeScript} from './dsl';

// 두 DSL 스크립트가 의미상 같은지 비교. 인자를 decompile 과 같은 공간으로 정규화한 뒤
// 비교하므로 LLM 이 숫자를 "10" 문자열로 돌려줘도 값이 같으면 동일로 본다.
const sameScript = (a, b) =>
    JSON.stringify(normalizeScript(a)) === JSON.stringify(normalizeScript(b));

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

// djb2 → base36; deterministic, no deps. Used only for the find fingerprint.
const hashStr = function (str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = (((h << 5) + h) + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
};

/**
 * Identity fingerprint of a DSL script: a short hash of its FULL normalized body.
 * Normalization (normalizeScript) makes "10" and 10 hash equally. Two scripts
 * collide only if byte-identical after normalization (then editing either is
 * harmless) or on a negligibly rare 32-bit hash collision. The app prints this
 * next to each numbered script; the model copies
 * it into an edit's `find`, letting the app verify the model targeted the script
 * it meant (defends against a plausible-but-wrong id).
 * @param {object} script - {hat, body}
 * @returns {string} short base36 fingerprint ('' for a falsy script)
 */
export const scriptFingerprint = function (script) {
    return script ? hashStr(JSON.stringify(normalizeScript(script))) : '';
};

/**
 * Resolve model edits to add/replace/remove ops against the current program.
 * 1-based id (#1 = current[0]). Fail-closed:
 *   add    → needs script.
 *   modify → needs script, in-range id, AND find === scriptFingerprint(current[id-1]).
 *   remove → needs in-range id AND find === scriptFingerprint(current[id-1]).
 * Anything else is dropped (no-op, never a wrong edit).
 * @param {Array<object>} edits - [{action, id?, find?, script?}, ...]
 * @param {Array<object>} current - decompiled current program the ids reference
 * @returns {Array<object>} ops (add/replace/remove; keeps implicit)
 */
export const editsToOps = function (edits, current) {
    if (!Array.isArray(edits)) return [];
    const base = Array.isArray(current) ? current : [];
    const ops = [];
    for (const e of edits) {
        if (!e || typeof e !== 'object') continue;
        if (e.action === 'add') {
            if (e.script) ops.push({type: 'add', index: null, script: e.script});
            continue;
        }
        if (e.action !== 'modify' && e.action !== 'remove') continue;
        const idx = Number.isInteger(e.id) ? e.id - 1 : -1;
        if (idx < 0 || idx >= base.length) continue;
        if (e.find !== scriptFingerprint(base[idx])) continue; // wrong/missing find → drop (C2)
        if (e.action === 'modify') {
            if (e.script) ops.push({type: 'replace', index: idx, script: e.script});
        } else {
            ops.push({type: 'remove', index: idx});
        }
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
 * 미리 만들어진 op 목록(add/replace/remove; keep 은 op 부재로 암시)을 scratch-vm
 * 대상에 적용한다. applyEdit 에서 추출 — id 기반 편집 경로가 위치 diff 없이 ops 를
 * 바로 넘길 수 있게 한다. 바뀐 스크립트만 건드리고 나머지는 vm 안에서 그대로 산다.
 *
 * 주의: 프로젝트가 실행 중이면 먼저 멈추고 호출할 것(deleteBlock 은 도는 스레드를
 * 정리하지 않음 — scratch-vm 의 @todo). op.index(replace/remove)는 라이브
 * scriptHatIds 순서 기준 0-based — 호출자(applyProposal 의 stale guard)가 라이브
 * 순서 == base 스냅샷 순서를 보장한다. add 는 index:null.
 *
 * @param {VirtualMachine} vm - 편집을 적용할 vm
 * @param {Array<object>} ops - {type:'add'|'replace'|'remove', index, script?}
 * @param {string} [targetId] - 편집할 스프라이트 id (생략 시 현재 editingTarget — 콘솔 스모크 하위호환).
 * @returns {Promise<Array>} 적용한 연산 목록
 */
export const applyOps = async function (vm, ops, targetId) {
    // 고정된 targetId 가 있는데 그 스프라이트가 (요청 중 삭제로) 사라졌으면 fail-closed:
    // editingTarget 로 폴백하지 않고 던진다 → 다른 스프라이트 오염 방지. targetId 없으면
    // 현재 editingTarget(콘솔 스모크 하위호환).
    const target = targetId ? vm.runtime.getTargetById(targetId) : vm.editingTarget;
    if (!target) throw new Error('applyOps: pinned target no longer exists');
    const blocks = target.blocks;
    // op.index 와 인덱스가 일치하는 hat id 스냅샷 — 삭제로 순서가 흔들려도 id 로 짚는다.
    // 호출자(applyProposal 의 stale guard)가 라이브 순서 == base 스냅샷 순서를 보장한다.
    const hatIds = scriptHatIds(blocks);

    // 옮겨 심을 새 스크립트들을 먼저 컴파일(삭제 전에 옛 좌표를 읽어 보존).
    const toShare = [];
    for (const op of ops) {
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

/**
 * 옛/새 DSL 을 위치 기반 diff 로 비교해 적용한다(레거시: window.vibe 스모크 + dev-console edit()).
 * @param {VirtualMachine} vm - 편집을 적용할 vm
 * @param {Array<object>} oldScripts - 편집 전 DSL (decompile 결과)
 * @param {Array<object>} newScripts - LLM 이 돌려준 수정본 DSL
 * @param {string} [targetId] - 편집할 스프라이트 id (생략 시 현재 editingTarget)
 * @returns {Promise<Array>} 적용한 연산 목록
 */
export const applyEdit = function (vm, oldScripts, newScripts, targetId) {
    return applyOps(vm, diff(oldScripts, newScripts), targetId);
};
