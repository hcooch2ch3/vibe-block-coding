/**
 * @jest-environment node
 */
/* eslint-disable no-console */
// LIVE eval (real Haiku calls) of the id+fingerprint edit protocol. Scores each
// labeled case via the production editsToOps path. NOT run by test:unit (lives under
// test/smoke). Needs a real key: $ANTHROPIC_API_KEY or a file at /tmp/vibe-ak.
// Without a key the suite is skipped (so it never fails CI).
//
//   npx jest test/smoke/eval-edits.smoke.test.js --runInBand
import fs from 'fs';
import {requestTurn} from '../../src/lib/ai-harness/llm';
import {editsToOps} from '../../src/lib/ai-harness/edit';

const KEY = (process.env.ANTHROPIC_API_KEY ||
    (fs.existsSync('/tmp/vibe-ak') ? fs.readFileSync('/tmp/vibe-ak', 'utf8') : '')).trim();

const OP_FOR_ACTION = {add: 'add', modify: 'replace', remove: 'remove'};
const f = body => ({hat: 'when_flag', body});

const CASES = [
    // add
    {instruction: 'also make it say hello', currentScripts: [f([['move', 10]])], expect: {action: 'add'}},
    {instruction: 'make it spin forever too', currentScripts: [f([['say', 'Hi']])], expect: {action: 'add'}},
    {instruction: 'add a jump when clicked', currentScripts: [f([['move', 10]])], expect: {action: 'add'}},
    {instruction: 'make the cat walk around', currentScripts: [], expect: {action: 'add'}},
    // modify
    {instruction: 'make it move faster', currentScripts: [f([['move', 10]])], expect: {action: 'modify', findIndex: 0}},
    {instruction: 'change the greeting to Bye', currentScripts: [f([['say', 'Hello']])], expect: {action: 'modify', findIndex: 0}},
    {instruction: 'make it turn a bigger angle', currentScripts: [f([['forever', [['turn', 15]]]])], expect: {action: 'modify', findIndex: 0}},
    {instruction: 'change the 2nd script to say goodbye',
        currentScripts: [f([['move', 10]]), f([['say', 'hi']])], expect: {action: 'modify', findIndex: 1}},
    // remove
    {instruction: 'stop spinning', currentScripts: [f([['forever', [['turn', 15]]]])], expect: {action: 'remove', findIndex: 0}},
    {instruction: 'delete the hello message', currentScripts: [f([['say', 'Hello']])], expect: {action: 'remove', findIndex: 0}},
    {instruction: 'remove the walking, keep talking',
        currentScripts: [f([['forever', [['move', 10]]]]), f([['say', 'hi']])], expect: {action: 'remove', findIndex: 0}},
    {instruction: 'get rid of the second script',
        currentScripts: [f([['move', 10]]), f([['say', 'bye']])], expect: {action: 'remove', findIndex: 1}}
];

(KEY ? describe : describe.skip)('evalEdits (live Haiku protocol compliance)', () => {
    jest.setTimeout(180000);
    test('rate >= 0.8', async () => {
        let correct = 0;
        for (const c of CASES) {
            let ok = false;
            let edits;
            try {
                ({edits} = await requestTurn({apiKey: KEY, instruction: c.instruction, currentScripts: c.currentScripts}));
                const ops = editsToOps(edits || [], c.currentScripts);
                const want = c.expect;
                ok = ops.length === 1 && ops[0].type === OP_FOR_ACTION[want.action];
                if (ok && typeof want.findIndex !== 'undefined') ok = ops[0].index === want.findIndex;
                console.log(`${ok ? 'PASS' : 'FAIL'}  "${c.instruction}"  ops=${JSON.stringify(
                    editsToOps(edits || [], c.currentScripts).map(o => ({t: o.type, i: o.index})))}  edits=${JSON.stringify(edits)}`);
            } catch (e) {
                console.log(`ERR   "${c.instruction}"  -> ${e.message}`);
            }
            if (ok) correct++;
        }
        const rate = correct / CASES.length;
        console.log(`\n=== rate ${correct}/${CASES.length} = ${rate.toFixed(2)} ===`);
        expect(rate).toBeGreaterThanOrEqual(0.8);
    });
});
