/**
 * AI 하니스 — DSL ↔ Scratch 블록 변환기.
 *
 * LLM은 짧고 친화적인 미니 DSL(예: ['move', 10])을 다루고, scratch-vm은 장황한
 * 런타임 블록 객체를 다룬다. 이 모듈이 그 사이를 양방향 번역한다.
 *
 *   compile:   DSL 스크립트 → 블록 배열 (vm.shareBlocksToTarget 에 넘김)
 *   decompile: Blocks 인스턴스 → DSL 스크립트 (현재 프로그램을 LLM에 보여줄 때)
 *
 * 헤드리스 왕복 테스트로 검증됨(compile→decompile 항등). OPMAP 테이블에 항목을
 * 추가하는 것만으로 지원 opcode가 확장된다.
 */

// DSL 이름 → {opcode, hat?, inputs:[{name, shadow, field}]}
// inputs 는 값 입력마다 생성할 shadow 블록 명세.
// shadow 는 vm 실행뿐 아니라 에디터에 뜨는 입력 위젯 종류도 결정하므로(예:
// math_positive_number = 음수 못 넣는 칸), 런타임 수용값이 아니라 아이에게 보이는
// scratch-blocks 위젯에 맞춰야 한다. (왕복 테스트는 이 위젯 차이를 못 잡음.)
export const OPMAP = {
    when_flag: {opcode: 'event_whenflagclicked', hat: true, inputs: []},
    when_clicked: {opcode: 'event_whenthisspriteclicked', hat: true, inputs: []},
    move: {opcode: 'motion_movesteps', inputs: [{name: 'STEPS', shadow: 'math_number', field: 'NUM'}]},
    turn: {opcode: 'motion_turnright', inputs: [{name: 'DEGREES', shadow: 'math_number', field: 'NUM'}]},
    goto: {opcode: 'motion_gotoxy',
        inputs: [
            {name: 'X', shadow: 'math_number', field: 'NUM'},
            {name: 'Y', shadow: 'math_number', field: 'NUM'}
        ]},
    change_x: {opcode: 'motion_changexby', inputs: [{name: 'DX', shadow: 'math_number', field: 'NUM'}]},
    set_x: {opcode: 'motion_setx', inputs: [{name: 'X', shadow: 'math_number', field: 'NUM'}]},
    change_y: {opcode: 'motion_changeyby', inputs: [{name: 'DY', shadow: 'math_number', field: 'NUM'}]},
    set_y: {opcode: 'motion_sety', inputs: [{name: 'Y', shadow: 'math_number', field: 'NUM'}]},
    if_on_edge_bounce: {opcode: 'motion_ifonedgebounce', inputs: []},
    say: {opcode: 'looks_say', inputs: [{name: 'MESSAGE', shadow: 'text', field: 'TEXT'}]},
    think: {opcode: 'looks_think', inputs: [{name: 'MESSAGE', shadow: 'text', field: 'TEXT'}]},
    say_secs: {opcode: 'looks_sayforsecs',
        inputs: [
            {name: 'MESSAGE', shadow: 'text', field: 'TEXT'},
            {name: 'SECS', shadow: 'math_number', field: 'NUM'}
        ]},
    think_secs: {opcode: 'looks_thinkforsecs',
        inputs: [
            {name: 'MESSAGE', shadow: 'text', field: 'TEXT'},
            {name: 'SECS', shadow: 'math_number', field: 'NUM'}
        ]},
    set_size: {opcode: 'looks_setsizeto', inputs: [{name: 'SIZE', shadow: 'math_number', field: 'NUM'}]},
    change_size: {opcode: 'looks_changesizeby', inputs: [{name: 'CHANGE', shadow: 'math_number', field: 'NUM'}]},
    show: {opcode: 'looks_show', inputs: []},
    hide: {opcode: 'looks_hide', inputs: []},
    next_costume: {opcode: 'looks_nextcostume', inputs: []},
    wait: {opcode: 'control_wait', inputs: [{name: 'DURATION', shadow: 'math_positive_number', field: 'NUM'}]},
    repeat: {
        opcode: 'control_repeat',
        inputs: [{name: 'TIMES', shadow: 'math_whole_number', field: 'NUM'}],
        substack: 'SUBSTACK'
    },
    // forever 는 cap 블록(뒤에 스텝 불가) — compile 은 강제 안 함, parseDSL 이 거부(Task 3).
    forever: {opcode: 'control_forever', inputs: [], substack: 'SUBSTACK'}
};

// opcode → {name, spec} 역방향 매핑 (decompile 용)
const REV = {};
for (const [name, spec] of Object.entries(OPMAP)) REV[spec.opcode] = {name, spec};

let counter = 0;
const uid = () => `dsl_${Date.now().toString(36)}_${(counter++).toString(36)}`;

/**
 * DSL 스크립트 하나를 런타임 블록 배열로 컴파일한다.
 * @param {{hat: string, body: Array<Array>}} script - 예: {hat:'when_flag', body:[['move',10]]}
 * @returns {Array<object>} scratch-vm 블록 객체 배열 (shareBlocksToTarget 형식)
 */
export const compileScript = function (script) {
    const out = [];
    // 스텝 리스트를 next-chain 으로 컴파일하고 첫 블록을 돌려준다. 하위 스택은
    // 내부 이름(emitSeq)으로 재귀. 첫 스텝만 topLevel(hat, x/y).
    const emitSequence = function emitSeq (steps, parentId, topLevel) {
        let first = null;
        let prev = null;
        let isTop = topLevel;
        for (const step of steps) {
            const [name, ...rest] = step;
            const spec = OPMAP[name];
            if (!spec) throw new Error(`미지원 opcode: ${name}`);
            const id = uid();
            const block = {
                id,
                opcode: spec.opcode,
                inputs: {},
                fields: {},
                next: null,
                parent: prev ? prev.id : (parentId || null),
                topLevel: Boolean(isTop),
                shadow: false
            };
            if (isTop) {
                block.x = 80; block.y = 80;
            }
            spec.inputs.forEach((inp, i) => {
                const sid = uid();
                out.push({
                    id: sid,
                    opcode: inp.shadow,
                    inputs: {},
                    fields: {[inp.field]: {name: inp.field, value: String(rest[i])}},
                    next: null,
                    parent: id,
                    topLevel: false,
                    shadow: true
                });
                block.inputs[inp.name] = {name: inp.name, block: sid, shadow: sid};
            });
            if (spec.substack) {
                // omit the SUBSTACK input entirely when the body is empty
                const subFirst = emitSeq(rest[spec.inputs.length] || [], id, false);
                if (subFirst) {
                    block.inputs[spec.substack] = {name: spec.substack, block: subFirst.id, shadow: null};
                }
            }
            out.push(block);
            if (!first) first = block;
            if (prev) prev.next = block.id;
            prev = block;
            isTop = false;
        }
        return first;
    };
    // hat + body 를 한 시퀀스로: 첫 스텝(hat) 이 topLevel, 나머지가 next 로 이어짐.
    emitSequence([[script.hat], ...script.body], null, true);
    return out;
};

/**
 * 여러 DSL 스크립트를 하나의 블록 배열로 컴파일한다.
 * @param {Array<{hat: string, body: Array<Array>}>} scripts - DSL 스크립트 배열
 * @returns {Array<object>} 합쳐진 scratch-vm 블록 객체 배열
 */
export const compile = function (scripts) {
    return scripts.flatMap(compileScript);
};

// 숫자꼴 문자열은 Number 로, 그 외는 문자열 그대로 (필드 값 역변환).
const coerce = v => (/^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v);

/**
 * DSL 스크립트의 body 인자를 decompile 과 동일하게 coerce 해 정규화한다.
 * LLM 은 숫자를 "10" 처럼 문자열로 돌려주기도 하는데, decompile 결과와 같은 공간에
 * 놓아야 diff 가 의미 비교(값이 같으면 동일)를 할 수 있다.
 * @param {object} script - {hat, body} DSL 스크립트
 * @returns {object} 인자가 coerce 된 새 스크립트
 */
// DSL 스텝 하나를 정규화 (값 인자 coerce + 하위 스택 재귀).
const normalizeStep = function (step) {
    const [name, ...rest] = step;
    const spec = OPMAP[name];
    const n = spec ? spec.inputs.length : rest.length;
    // text shadow 는 문자열 유지(decompile 과 동일 공간). 안 그러면 sameScript 가
    // '5'/'05'/'5.0' 를 동일로 봐 텍스트 편집이 조용히 keep 으로 떨어진다.
    const valueArgs = rest.slice(0, n).map((v, i) =>
        ((spec && spec.inputs[i] && spec.inputs[i].shadow === 'text') ? String(v) : coerce(v)));
    if (spec && spec.substack) {
        return [name, ...valueArgs, (rest[n] || []).map(normalizeStep)];
    }
    return [name, ...valueArgs];
};

export const normalizeScript = function (script) {
    return {hat: script.hat, body: script.body.map(normalizeStep)};
};

// 블록/next 시퀀스를 body 배열로 역변환. 각 블록을 스텝으로 풀고, 하위 스택은
// 내부 이름(decompileSeq)으로 재귀한다.
const decompileSequence = function decompileSeq (blocks, firstId) {
    const body = [];
    let cur = firstId;
    while (cur) {
        const block = blocks.getBlock(cur);
        const entry = REV[block.opcode];
        if (!entry) throw new Error(`역매핑 없음: ${block.opcode}`);
        const args = entry.spec.inputs.map(inp => {
            const val = blocks.getBlock(block.inputs[inp.name].block).fields[inp.field].value;
            // text shadow 는 문자열 그대로, 숫자 shadow 만 coerce.
            return inp.shadow === 'text' ? val : coerce(val);
        });
        if (entry.spec.substack) {
            const sub = block.inputs[entry.spec.substack];
            body.push([entry.name, ...args, decompileSeq(blocks, sub ? sub.block : null)]);
        } else {
            body.push([entry.name, ...args]);
        }
        cur = block.next;
    }
    return body;
};

// hat id 로 시작하는 스택 하나를 {hat, body} DSL 스크립트로 역변환.
const decompileScript = function (blocks, hatId) {
    const hat = blocks.getBlock(hatId);
    return {hat: REV[hat.opcode].name, body: decompileSequence(blocks, hat.next)};
};

/**
 * 지원하는 top-level hat 블록의 id를 워크스페이스 순서대로 돌려준다.
 * decompile 이 만드는 스크립트 배열과 인덱스가 일치하므로, 편집(applyEdit)이
 * "N번째 스크립트"를 실제 블록으로 되짚을 때 이 순서를 공유한다.
 * @param {Blocks} blocks - vm.editingTarget.blocks
 * @returns {Array<string>} hat 블록 id 배열
 */
export const scriptHatIds = function (blocks) {
    return blocks._scripts
        .map(id => blocks.getBlock(id))
        .filter(b => REV[b.opcode] && REV[b.opcode].spec.hat)
        .map(b => b.id);
};

/**
 * Blocks 인스턴스의 모든 top-level hat 스크립트를 DSL로 역변환한다.
 * @param {Blocks} blocks - vm.editingTarget.blocks
 * @returns {Array<object>} DSL 스크립트({hat, body}) 배열
 */
export const decompile = function (blocks) {
    return scriptHatIds(blocks).map(id => decompileScript(blocks, id));
};
