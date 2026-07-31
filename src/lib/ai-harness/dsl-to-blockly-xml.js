/**
 * Convert one decompiled DSL script into a scratch-blocks XML string for a
 * read-only preview workspace. Shadow types/fields come only from OPMAP (single
 * source of truth). A script renders as ONE connected top-level stack: the hat,
 * then body steps chained via <next>, with loop bodies as <statement> substacks.
 */

import {OPMAP} from './dsl';

const esc = value => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Chain an array of DSL steps into nested <block>…<next>…</next></block> XML.
const chainSteps = function (steps) {
    if (!steps.length) return '';
    const [step, ...rest] = steps;
    const restXml = chainSteps(rest);
    const [op, ...args] = step;
    const spec = OPMAP[op];
    if (!spec) return restXml; // unknown op: skip this block, keep the rest

    const nInputs = spec.inputs.length;
    let inner = '';
    spec.inputs.forEach((input, i) => {
        inner += `<value name="${input.name}"><shadow type="${input.shadow}">` +
            `<field name="${input.field}">${esc(args[i])}</field></shadow></value>`;
    });
    if (spec.substack) {
        const sub = args[nInputs] || [];
        if (sub.length) inner += `<statement name="${spec.substack}">${chainSteps(sub)}</statement>`;
    }
    // cap blocks (forever) terminate the stack — never chain a sibling after them
    const nextXml = (!spec.cap && restXml) ? `<next>${restXml}</next>` : '';
    return `<block type="${spec.opcode}">${inner}${nextXml}</block>`;
};

/**
 * @param {object} script - a decompiled DSL script {hat, body}
 * @returns {string} - an <xml>…</xml> string for ScratchBlocks.Xml.textToDom
 */
export const scriptToXml = function (script) {
    const bodyXml = chainSteps(script.body || []);
    const hatSpec = OPMAP[script.hat];
    let top;
    if (hatSpec) {
        const nextXml = bodyXml ? `<next>${bodyXml}</next>` : '';
        top = `<block type="${hatSpec.opcode}">${nextXml}</block>`;
    } else {
        top = bodyXml; // no hat (defensive) — render the body alone
    }
    return `<xml xmlns="http://www.w3.org/1999/xhtml">${top}</xml>`;
};
