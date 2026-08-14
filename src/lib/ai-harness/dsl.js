/**
 * AI harness: DSL ↔ Scratch block converter.
 *
 * The LLM works with a short, friendly mini DSL (e.g. ['move', 10]), while
 * scratch-vm works with verbose runtime block objects. This module translates
 * between the two, in both directions.
 *
 *   compile:   DSL script → block array (passed to vm.shareBlocksToTarget)
 *   decompile: Blocks instance → DSL script (to show the current program to the LLM)
 *
 * Verified by headless round-trip tests (compile→decompile identity). Adding an
 * entry to the OPMAP table is all it takes to extend the supported opcodes.
 */

// DSL name → {opcode, hat?, inputs:[{name, shadow, field}]}
// inputs is the shadow block spec to create for each value input.
// shadow drives vm execution and also picks the input widget shown in the
// editor (e.g. math_positive_number = a slot that rejects negatives), so it must
// match the scratch-blocks widget the child sees, not the runtime accepted value.
// (Round-trip tests do not catch this widget difference.)
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
    // forever is a cap block (no steps can follow): compile does not enforce it, parseDSL rejects via cap.
    forever: {opcode: 'control_forever', inputs: [], substack: 'SUBSTACK', cap: true}
};

// opcode → {name, spec} reverse mapping (for decompile)
const REV = {};
for (const [name, spec] of Object.entries(OPMAP)) REV[spec.opcode] = {name, spec};

let counter = 0;
const uid = () => `dsl_${Date.now().toString(36)}_${(counter++).toString(36)}`;

/**
 * Compile one DSL script into a runtime block array.
 * @param {{hat: string, body: Array<Array>}} script - e.g. {hat:'when_flag', body:[['move',10]]}
 * @returns {Array<object>} array of scratch-vm block objects (shareBlocksToTarget format)
 */
export const compileScript = function (script) {
    const out = [];
    // Compile a step list into a next-chain and return the first block. Substacks
    // recurse via the inner name (emitSeq). Only the first step is topLevel (hat, x/y).
    const emitSequence = function emitSeq (steps, parentId, topLevel) {
        let first = null;
        let prev = null;
        let isTop = topLevel;
        for (const step of steps) {
            const [name, ...rest] = step;
            const spec = OPMAP[name];
            if (!spec) throw new Error(`unsupported opcode: ${name}`);
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
    // hat + body as one sequence: the first step (hat) is topLevel, the rest chain via next.
    emitSequence([[script.hat], ...script.body], null, true);
    return out;
};

/**
 * Compile several DSL scripts into a single block array.
 * @param {Array<{hat: string, body: Array<Array>}>} scripts - array of DSL scripts
 * @returns {Array<object>} merged array of scratch-vm block objects
 */
export const compile = function (scripts) {
    return scripts.flatMap(compileScript);
};

// Numeric-looking strings become Number, everything else stays a string (field value back-conversion).
const coerce = v => (/^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v);

/**
 * Normalize a DSL script's body args by coercing them the same way decompile does.
 * The LLM sometimes returns numbers as strings like "10", and they must sit in the
 * same space as decompile output so diff can compare by meaning (equal value = same).
 * @param {object} script - {hat, body} DSL script
 * @returns {object} a new script with coerced args
 */
// Normalize one DSL step (coerce value args + recurse into substack).
const normalizeStep = function (step) {
    const [name, ...rest] = step;
    const spec = OPMAP[name];
    const n = spec ? spec.inputs.length : rest.length;
    // text shadow stays a string (same space as decompile). Otherwise sameScript
    // treats '5'/'05'/'5.0' as equal and text edits silently drop to keep.
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

// Convert a block/next sequence back into a body array. Each block unfolds into a
// step, and substacks recurse via the inner name (decompileSeq).
const decompileSequence = function decompileSeq (blocks, firstId) {
    const body = [];
    let cur = firstId;
    while (cur) {
        const block = blocks.getBlock(cur);
        const entry = REV[block.opcode];
        if (!entry) throw new Error(`no reverse mapping: ${block.opcode}`);
        const args = entry.spec.inputs.map(inp => {
            const val = blocks.getBlock(block.inputs[inp.name].block).fields[inp.field].value;
            // text shadow stays a string, only numeric shadow is coerced.
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

// Convert one stack starting at hat id back into a {hat, body} DSL script.
const decompileScript = function (blocks, hatId) {
    const hat = blocks.getBlock(hatId);
    return {hat: REV[hat.opcode].name, body: decompileSequence(blocks, hat.next)};
};

/**
 * Return the ids of supported top-level hat blocks in workspace order.
 * The index matches the script array decompile produces, so edits (applyEdit)
 * share this order when mapping "the Nth script" back to actual blocks.
 * @param {Blocks} blocks - vm.editingTarget.blocks
 * @returns {Array<string>} array of hat block ids
 */
export const scriptHatIds = function (blocks) {
    return blocks._scripts
        .map(id => blocks.getBlock(id))
        .filter(b => REV[b.opcode] && REV[b.opcode].spec.hat)
        .map(b => b.id);
};

// True iff every value input of `block` points to a shadow literal carrying the
// expected field. A reporter plugged into a NUM/TEXT slot (inputs[name].block is a
// non-shadow block, so it lacks fields[field]) makes the block unrepresentable.
const inputsAreLiteral = function (blocks, block, spec) {
    return spec.inputs.every(inp => {
        const ref = block.inputs[inp.name];
        if (!ref || !ref.block) return false;
        const vb = blocks.getBlock(ref.block);
        return Boolean(vb && vb.fields && vb.fields[inp.field]);
    });
};

// Walk a next-chain (and substacks) checking every block is round-trippable. Mirrors
// decompileSequence's access path exactly, so for VM-resident blocks "representable" ==
// "decompile succeeds". (On un-sanitized/dangling state it is strictly more defensive:
// it returns false where decompile would throw, never a dangerous false positive.)
const seqRepresentable = function seqRep (blocks, firstId) {
    let cur = firstId;
    while (cur) {
        const block = blocks.getBlock(cur);
        if (!block) return false;
        const entry = REV[block.opcode];
        if (!entry) return false; // unknown opcode
        if (!inputsAreLiteral(blocks, block, entry.spec)) return false;
        if (entry.spec.substack) {
            const sub = block.inputs[entry.spec.substack];
            if (sub && sub.block && !seqRep(blocks, sub.block)) return false;
        }
        cur = block.next;
    }
    return true;
};

/**
 * True iff the whole hat-script at hatId can be faithfully decompiled to DSL.
 * A false result means the script must stay inert (invisible + never edited).
 * @param {Blocks} blocks - vm target blocks
 * @param {string} hatId - candidate top-level hat id
 * @returns {boolean} true if the whole script round-trips through the DSL
 */
export const isRepresentable = function (blocks, hatId) {
    const hat = blocks.getBlock(hatId);
    if (!hat) return false;
    const entry = REV[hat.opcode];
    if (!entry || !entry.spec.hat) return false;
    return seqRepresentable(blocks, hat.next);
};

/**
 * Supported hat ids whose entire script is representable, in workspace order.
 * The SHARED index space for the tolerant edit path: decompile() and applyOps() both
 * enumerate this list, so the Nth entry here is the Nth script decompile() emits, keeping
 * id-based edits aligned. Non-representable scripts are filtered out here, so decompile()
 * skips them instead of throwing and applyOps() never indexes or deletes them.
 * @param {Blocks} blocks - vm target blocks
 * @returns {Array<string>} representable hat ids in workspace order
 */
export const editableHatIds = function (blocks) {
    return scriptHatIds(blocks).filter(id => isRepresentable(blocks, id));
};

/**
 * Decompile every top-level hat script of a Blocks instance into DSL.
 * @param {Blocks} blocks - vm.editingTarget.blocks
 * @returns {Array<object>} array of DSL scripts ({hat, body})
 */
export const decompile = function (blocks) {
    return editableHatIds(blocks).map(id => decompileScript(blocks, id));
};
