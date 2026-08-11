/**
 * AI harness: editing (diff/apply).
 *
 * Half the novelty of the bidirectional edit loop: decompile the current program
 * to DSL, hand it to the LLM to modify, then compare old DSL against new DSL and
 * re-plant only the changed scripts as blocks. Untouched scripts stay alive as-is
 * inside the vm (that is real "preserve existing").
 *
 *   diff:      old DSL[] vs new DSL[] → per-script op list (pure function, easy to test)
 *   applyEdit: apply those ops to a scratch-vm target (inject only the changes)
 *
 * MVP granularity = whole per-script rebuild. If one block inside a script changes,
 * the whole script is recompiled (element-level splice is future work). Matching is
 * by array position (index): reorders and duplicate hats degrade to "all changed".
 */

import {compileScript, scriptHatIds, normalizeScript} from './dsl';

// Compare whether two DSL scripts are semantically equal. Args are normalized into
// the same space as decompile before comparing, so if the LLM returns a number as
// the string "10", equal values are still treated as identical.
const sameScript = (a, b) =>
    JSON.stringify(normalizeScript(a)) === JSON.stringify(normalizeScript(b));

/**
 * Compare old/new DSL script arrays by position to build an op list.
 * @param {Array<object>} oldScripts - result of decompile(current blocks)
 * @param {Array<object>} newScripts - the edited version returned by the LLM
 * @returns {Array<object>} keep | replace | add | remove op list
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

// Move the top-level block's coordinates in a compiled block array to a given position (preserve position on rebuild).
const placeAt = function (compiled, x, y) {
    const top = compiled.find(b => b.topLevel);
    if (top) {
        top.x = x;
        top.y = y;
    }
    return compiled;
};

/**
 * Apply a prebuilt op list (add/replace/remove; keep is implied by op absence) to a
 * scratch-vm target. Extracted from applyEdit so the id-based edit path can pass ops
 * directly without a positional diff. Touch only the changed scripts; the rest stay
 * alive inside the vm.
 *
 * Note: if the project is running, stop it before calling (deleteBlock does not clean
 * up running threads, a scratch-vm @todo). op.index (replace/remove) is 0-based on the
 * live scriptHatIds order: the caller (applyProposal's stale guard) guarantees live
 * order == base snapshot order. add uses index:null.
 *
 * @param {VirtualMachine} vm - the vm to apply edits to
 * @param {Array<object>} ops - {type:'add'|'replace'|'remove', index, script?}
 * @param {string} [targetId] - sprite id to edit (defaults to current editingTarget, console smoke back-compat).
 * @returns {Promise<Array>} the applied op list
 */
export const applyOps = async function (vm, ops, targetId) {
    // If a pinned targetId is given but its sprite is gone (deleted mid-request), fail-closed:
    // throw instead of falling back to editingTarget → avoid corrupting a different sprite. If no
    // targetId, use the current editingTarget (console smoke back-compat).
    const target = targetId ? vm.runtime.getTargetById(targetId) : vm.editingTarget;
    if (!target) throw new Error('applyOps: pinned target no longer exists');
    const blocks = target.blocks;
    // Snapshot of hat ids indexed to match op.index: even if deletion shifts the order, we point by id.
    // The caller (applyProposal's stale guard) guarantees live order == base snapshot order.
    const hatIds = scriptHatIds(blocks);

    // Compile the new scripts to plant first (read old coordinates before deletion to preserve them).
    const toShare = [];
    for (const op of ops) {
        if (op.type === 'add') {
            toShare.push(compileScript(op.script));
        } else if (op.type === 'replace') {
            const oldHat = blocks.getBlock(hatIds[op.index]);
            toShare.push(placeAt(compileScript(op.script), oldHat.x, oldHat.y));
        }
    }

    // Delete the changed/removed old scripts (delete the hat → next recursion cleans up the whole stack).
    for (const op of ops) {
        if (op.type === 'replace' || op.type === 'remove') {
            blocks.deleteBlock(hatIds[op.index]);
        }
    }

    // Inject the new/modified scripts.
    for (const compiled of toShare) {
        await vm.shareBlocksToTarget(compiled, target.id);
    }

    vm.refreshWorkspace();
    return ops;
};

/**
 * Compare old/new DSL by positional diff and apply (legacy: window.vibe smoke + dev-console edit()).
 * @param {VirtualMachine} vm - the vm to apply edits to
 * @param {Array<object>} oldScripts - pre-edit DSL (decompile result)
 * @param {Array<object>} newScripts - the edited DSL returned by the LLM
 * @param {string} [targetId] - sprite id to edit (defaults to current editingTarget)
 * @returns {Promise<Array>} the applied op list
 */
export const applyEdit = function (vm, oldScripts, newScripts, targetId) {
    return applyOps(vm, diff(oldScripts, newScripts), targetId);
};
