// End-to-end seam test for the bidirectional edit loop — the contest pitch:
// "말 → 블록 생성 → 다시 말 → 수정". Everything is real (headless scratch-vm,
// real compile/decompile/diff/apply); only the network fetch is mocked. This is
// the one path the per-module suites don't exercise, and it catches shape drift
// between parseDSL output and compile/applyEdit input.
import {requestScripts} from '../../../src/lib/ai-harness/llm';
import {compile, decompile} from '../../../src/lib/ai-harness/dsl';
import {applyEdit} from '../../../src/lib/ai-harness/edit';
import {makeHeadlessVM} from './headless-target';

const flag = body => ({hat: 'when_flag', body});

// A fetch that returns the given DSL scripts as an Anthropic text response.
const fetchReturning = scripts => async () => ({
    ok: true,
    json: async () => ({content: [{type: 'text', text: JSON.stringify(scripts)}]})
});

// scratch scripts are position-anchored; compare order-insensitively.
const asSet = scripts => scripts.map(s => JSON.stringify(s)).sort();

describe('generate -> edit loop (llm -> dsl -> edit, headless)', () => {
    test('말→블록 생성→다시 말→수정 closes end to end', async () => {
        const {vm, target} = makeHeadlessVM();

        // 1) 말 → 블록 생성
        const generated = await requestScripts(
            {apiKey: 'k', instruction: 'walk forward'},
            fetchReturning([flag([['move', 10]])])
        );
        await vm.shareBlocksToTarget(compile(generated), target.id);
        expect(decompile(target.blocks)).toEqual([flag([['move', 10]])]);

        // 2) 다시 말 → 수정 (현재 프로그램을 decompile 해 hat-id 정렬 유지)
        const current = decompile(target.blocks);
        const edited = await requestScripts(
            {apiKey: 'k', instruction: 'also say hi', currentScripts: current},
            fetchReturning([flag([['move', 10], ['say', 'hi']])])
        );
        await applyEdit(vm, current, edited);

        expect(asSet(decompile(target.blocks)))
            .toEqual(asSet([flag([['move', 10], ['say', 'hi']])]));
    });
});
