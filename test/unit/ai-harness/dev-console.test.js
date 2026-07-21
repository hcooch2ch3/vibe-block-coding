// The generate/edit helpers behind window.vibe — the reusable core the live
// smoke test and (week 2) the UI both call. Driven against a real headless
// scratch-vm; only fetch is mocked.
import {generate, edit} from '../../../src/lib/ai-harness/dev-console';
import {decompile} from '../../../src/lib/ai-harness/dsl';
import {makeHeadlessVM} from './headless-target';

const flag = body => ({hat: 'when_flag', body});
const asSet = scripts => scripts.map(s => JSON.stringify(s)).sort();

const fetchReturning = scripts => async () => ({
    ok: true,
    json: async () => ({content: [{type: 'text', text: JSON.stringify(scripts)}]})
});

describe('generate', () => {
    test('turns an instruction into blocks on the vm target', async () => {
        const {vm, target} = makeHeadlessVM();
        const result = await generate(
            vm,
            {apiKey: 'k', instruction: 'walk'},
            fetchReturning([flag([['move', 10]])])
        );
        expect(result).toEqual([flag([['move', 10]])]);
        expect(decompile(target.blocks)).toEqual([flag([['move', 10]])]);
    });
});

describe('edit', () => {
    test('edits the current program in place, preserving untouched work', async () => {
        const {vm, target} = makeHeadlessVM();
        await generate(vm, {apiKey: 'k', instruction: 'walk'},
            fetchReturning([flag([['move', 10]])]));

        const result = await edit(
            vm,
            {apiKey: 'k', instruction: 'say hi too'},
            fetchReturning([flag([['move', 10], ['say', 'hi']])])
        );
        expect(asSet(result)).toEqual(asSet([flag([['move', 10], ['say', 'hi']])]));
        expect(asSet(decompile(target.blocks)))
            .toEqual(asSet([flag([['move', 10], ['say', 'hi']])]));
    });
});
