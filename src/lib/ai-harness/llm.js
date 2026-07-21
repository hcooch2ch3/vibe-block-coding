/**
 * AI 하니스 — BYOK LLM 호출.
 *
 * 브라우저에서 사용자의 키로 Anthropic Messages API 를 직접 부른다(BYOK). LLM 은
 * 아이의 자연어를 미니 DSL(dsl.js 참고)로 바꿔 돌려주고, 그 DSL 이 compile/diff 를
 * 거쳐 블록이 된다. 생성(자연어→DSL)과 편집(현재 DSL + 지시→새 DSL)이 같은 경로다.
 *
 *   buildSystemPrompt / buildUserPrompt : 프롬프트 조립 (순수)
 *   parseDSL                            : 모델 텍스트에서 DSL 추출·검증 (순수)
 *   requestScripts                      : fetch 로 호출 (fetch 주입 가능 → 테스트)
 *
 * 브라우저 직접 호출이라 `anthropic-dangerous-direct-browser-access` 헤더가 필요하고,
 * 키는 로컬(사용자 소유)에 머문다. 기본 모델은 비용 민감한 아동 도구라 Haiku 4.5.
 */

import {OPMAP} from './dsl';

export const DEFAULT_MODEL = 'claude-haiku-4-5';
export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

/**
 * 지원 DSL 어휘를 OPMAP 에서 뽑아 모델에게 규칙을 설명하는 시스템 프롬프트.
 * @returns {string} 시스템 프롬프트
 */
export const buildSystemPrompt = function () {
    const lines = Object.entries(OPMAP).map(([name, spec]) => {
        const args = spec.inputs.map(inp => inp.name).join(', ');
        const kind = spec.hat ? ' (hat: starts a script)' : '';
        return args ? `- ${name}(${args})${kind}` : `- ${name}${kind}`;
    });
    return [
        'You turn a child\'s request into Scratch blocks, written as a tiny JSON DSL.',
        'Supported steps:',
        ...lines,
        '',
        'Reply with ONLY a JSON array of scripts. Each script is',
        '{"hat": "<hat step>", "body": [["step", ...args], ...]}.',
        'Use only the steps above. No prose, no explanations, no code fences.'
    ].join('\n');
};

/**
 * 사용자 프롬프트 조립. currentScripts 가 있으면 편집(현재 프로그램 동봉), 없으면 생성.
 * @param {object} opts - {instruction, currentScripts?}
 * @returns {string} 사용자 메시지 본문
 */
export const buildUserPrompt = function (opts) {
    const {instruction, currentScripts} = opts;
    if (currentScripts && currentScripts.length) {
        return [
            'Current program (JSON DSL):',
            JSON.stringify(currentScripts),
            '',
            `Edit it so that: ${instruction}`,
            'Return the FULL updated program; keep unchanged scripts identical.'
        ].join('\n');
    }
    return `Create a program so that: ${instruction}`;
};

// 코드펜스/산문에 섞인 응답에서 첫 JSON 값(배열 또는 객체) 문자열만 잘라낸다.
const sliceJSON = function (text) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const src = fenced ? fenced[1] : text;
    const start = src.search(/[[{]/);
    if (start === -1) throw new Error('LLM 응답에서 JSON 을 찾지 못함');
    const close = src[start] === '[' ? ']' : '}';
    const end = src.lastIndexOf(close);
    if (end < start) throw new Error('LLM 응답의 JSON 이 닫히지 않음');
    return src.slice(start, end + 1);
};

/**
 * 모델 텍스트에서 DSL 스크립트 배열을 추출하고 지원 opcode 인지 검증한다.
 * @param {string} text - 모델이 돌려준 원문
 * @returns {Array<object>} {hat, body} DSL 스크립트 배열
 */
export const parseDSL = function (text) {
    const parsed = JSON.parse(sliceJSON(text));
    const scripts = Array.isArray(parsed) ? parsed : [parsed];
    scripts.forEach(script => {
        if (!script || !OPMAP[script.hat]) {
            throw new Error(`미지원 hat: ${script && script.hat}`);
        }
        (script.body || []).forEach(([op]) => {
            if (!OPMAP[op]) throw new Error(`미지원 opcode: ${op}`);
        });
    });
    return scripts;
};

/**
 * 사용자의 키로 Anthropic Messages API 를 호출해 DSL 스크립트를 얻는다.
 * @param {object} config - {apiKey, model?, instruction, currentScripts?}
 * @param {Function} fetchImpl - 주입용 fetch (생략 시 전역 fetch)
 * @returns {Promise<Array<object>>} DSL 스크립트 배열
 */
export const requestScripts = async function (config, fetchImpl) {
    const {apiKey, model, instruction, currentScripts} = config;
    const doFetch = fetchImpl || fetch;
    const res = await doFetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
            'content-type': 'application/json'
        },
        body: JSON.stringify({
            model: model || DEFAULT_MODEL,
            max_tokens: 1024,
            system: buildSystemPrompt(),
            messages: [{role: 'user', content: buildUserPrompt({instruction, currentScripts})}]
        })
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg = (err.error && err.error.message) || `HTTP ${res.status}`;
        throw new Error(`LLM 호출 실패: ${msg}`);
    }
    const data = await res.json();
    const text = (data.content || []).map(block => block.text || '').join('');
    return parseDSL(text);
};
