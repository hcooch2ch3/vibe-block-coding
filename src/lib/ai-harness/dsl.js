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
export const OPMAP = {
    when_flag: {opcode: 'event_whenflagclicked', hat: true, inputs: []},
    move: {opcode: 'motion_movesteps', inputs: [{name: 'STEPS', shadow: 'math_number', field: 'NUM'}]},
    turn: {opcode: 'motion_turnright', inputs: [{name: 'DEGREES', shadow: 'math_number', field: 'NUM'}]},
    if_on_edge_bounce: {opcode: 'motion_ifonedgebounce', inputs: []},
    say: {opcode: 'looks_say', inputs: [{name: 'MESSAGE', shadow: 'text', field: 'TEXT'}]}
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
    const emit = (name, args, parent, topLevel) => {
        const spec = OPMAP[name];
        if (!spec) throw new Error(`미지원 opcode: ${name}`);
        const id = uid();
        const block = {
            id,
            opcode: spec.opcode,
            inputs: {},
            fields: {},
            next: null,
            parent: parent || null,
            topLevel: Boolean(topLevel),
            shadow: false
        };
        if (topLevel) {
            block.x = 80; block.y = 80;
        }
        spec.inputs.forEach((inp, i) => {
            const sid = uid();
            out.push({
                id: sid,
                opcode: inp.shadow,
                inputs: {},
                fields: {[inp.field]: {name: inp.field, value: String(args[i])}},
                next: null,
                parent: id,
                topLevel: false,
                shadow: true
            });
            block.inputs[inp.name] = {name: inp.name, block: sid, shadow: sid};
        });
        out.push(block);
        return block;
    };
    const hat = emit(script.hat, [], null, true);
    let prev = hat;
    for (const [op, ...args] of script.body) {
        const cur = emit(op, args, prev.id, false);
        prev.next = cur.id;
        prev = cur;
    }
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
export const normalizeScript = function (script) {
    return {
        hat: script.hat,
        body: script.body.map(([op, ...args]) => [op, ...args.map(coerce)])
    };
};

// 블록 하나를 DSL 스텝(['name', ...args])으로 역변환.
const decompileBlock = function (blocks, block) {
    const entry = REV[block.opcode];
    if (!entry) throw new Error(`역매핑 없음: ${block.opcode}`);
    const args = entry.spec.inputs.map(inp => {
        const sid = block.inputs[inp.name].block;
        const shadow = blocks.getBlock(sid);
        return coerce(shadow.fields[inp.field].value);
    });
    return [entry.name, ...args];
};

// hat id 로 시작하는 스택 하나를 {hat, body} DSL 스크립트로 역변환.
const decompileScript = function (blocks, hatId) {
    const hat = blocks.getBlock(hatId);
    const body = [];
    let cur = hat.next;
    while (cur) {
        const b = blocks.getBlock(cur);
        body.push(decompileBlock(blocks, b));
        cur = b.next;
    }
    return {hat: REV[hat.opcode].name, body};
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
