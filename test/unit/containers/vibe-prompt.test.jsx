import React from 'react';
import {shallow} from 'enzyme';
import {Provider} from 'react-redux';
import configureStore from 'redux-mock-store';

import {mountWithIntl} from '../../helpers/intl-helpers.jsx';
import VibePromptConnected, {VibePromptContainer} from '../../../src/containers/vibe-prompt';
import {saveKey, clearKey} from '../../../src/lib/ai-harness/key-store';
import * as devConsole from '../../../src/lib/ai-harness/dev-console';
import * as glowModule from '../../../src/lib/ai-harness/glow';
import * as uiPrefs from '../../../src/lib/ai-harness/ui-prefs';
import * as chatStore from '../../../src/lib/ai-harness/chat-store';

// The dev-console propose/applyProposal are covered by their own unit tests; here
// they are spied so these tests isolate the container's turn-model orchestration.
// The mock key-store lets the container start in the "ready" (has-key) state.
jest.mock('../../../src/lib/ai-harness/key-store', () => ({
    loadKey: () => 'sk-ant-test',
    saveKey: jest.fn(() => true),
    clearKey: jest.fn()
}));

const flushPromises = () => new Promise(resolve => setImmediate(resolve));
const noopEvent = {preventDefault: () => {}};

// A minimal proposal payload as propose() would return it (id+fingerprint ops shape).
const makeProposal = (targetId = 'sprite-a') => ({
    kind: 'edit',
    baseStamp: {targetId, baseHash: 'H'},
    ops: [{type: 'add', index: null, script: {hat: 'when_clicked', body: []}}]
});

const makeVm = blocks => {
    const target = {id: 'sprite-a', blocks};
    return {
        editingTarget: target,
        runtime: {getTargetById: id => (id === 'sprite-a' ? target : null)},
        stopAll: jest.fn()
    };
};

const render = vm => shallow(<VibePromptContainer vm={vm} />);

describe('VibePrompt container', () => {
    afterEach(() => {
        jest.restoreAllMocks();
        saveKey.mockClear();
        clearKey.mockClear();
    });

    describe('instruction submission — propose/apply gate', () => {
        test('submit appends a user turn and a pending proposal turn without injecting', async () => {
            const vm = makeVm({});
            const proposeSpy = jest.spyOn(devConsole, 'propose')
                .mockImplementation(() => Promise.resolve({answer: 'ok', proposal: makeProposal()}));
            const applySpy = jest.spyOn(devConsole, 'applyProposal')
                .mockImplementation(() => Promise.resolve({ok: true}));
            const wrapper = render(vm);
            wrapper.setState({instructionDraft: 'make the cat walk'});
            wrapper.instance().handleSubmitInstruction(noopEvent);
            await flushPromises();
            const {turns} = wrapper.instance().state;
            expect(turns).toHaveLength(2);
            expect(turns[0]).toMatchObject({role: 'user', text: 'make the cat walk'});
            expect(turns[1]).toMatchObject({role: 'ai', kind: 'proposal', status: 'pending'});
            expect(turns[1].preview).toEqual(makeProposal());
            expect(proposeSpy).toHaveBeenCalledTimes(1);
            expect(applySpy).not.toHaveBeenCalled(); // submit never injects
            // submit does NOT stopAll (that moved into applyProposal)
            expect(vm.stopAll).not.toHaveBeenCalled();
        });

        test('the pinned targetId reaches propose', async () => {
            const vm = makeVm({});
            const proposeSpy = jest.spyOn(devConsole, 'propose')
                .mockImplementation(() => Promise.resolve({answer: 'hi'}));
            const wrapper = render(vm);
            wrapper.setState({instructionDraft: 'say hi'});
            wrapper.instance().handleSubmitInstruction(noopEvent);
            await flushPromises();
            expect(proposeSpy.mock.calls[0][1].targetId).toBe('sprite-a');
        });

        test('a text-only reply appends an answer turn (no proposal)', async () => {
            const vm = makeVm({});
            jest.spyOn(devConsole, 'propose')
                .mockImplementation(() => Promise.resolve({answer: 'here is how it works'}));
            const wrapper = render(vm);
            wrapper.setState({instructionDraft: 'how do loops work?'});
            wrapper.instance().handleSubmitInstruction(noopEvent);
            await flushPromises();
            const {turns} = wrapper.instance().state;
            expect(turns).toHaveLength(2);
            expect(turns[1]).toMatchObject({role: 'ai', kind: 'answer', text: 'here is how it works'});
            expect(turns[1].preview).toBeUndefined();
        });
    });

    describe('apply / ignore gate (safety-critical)', () => {
        test('handleApply on a fresh proposal injects and marks the turn applied', async () => {
            const vm = makeVm({});
            const applySpy = jest.spyOn(devConsole, 'applyProposal')
                .mockImplementation(() => Promise.resolve({ok: true}));
            const wrapper = render(vm);
            const turn = {id: 3, role: 'ai', kind: 'proposal', status: 'pending', preview: makeProposal()};
            wrapper.setState({turns: [turn]});
            wrapper.instance().handleApply(turn);
            await flushPromises();
            expect(applySpy).toHaveBeenCalledTimes(1);
            expect(applySpy.mock.calls[0][1]).toEqual(makeProposal());
            expect(wrapper.instance().state.turns[0].status).toBe('applied');
        });

        test('glow is fail-open: a successful Apply stays "applied" even when the workspace is unavailable', async () => {
            const vm = makeVm({});
            jest.spyOn(devConsole, 'applyProposal')
                .mockImplementation(() => Promise.resolve({ok: true, changedTopIds: ['hat-1']}));
            const wrapper = render(vm);
            const turn = {id: 5, role: 'ai', kind: 'proposal', status: 'pending', preview: makeProposal()};
            wrapper.setState({turns: [turn]});
            // Under jsdom runGlow acquires the real ScratchBlocks singleton but
            // getMainWorkspace() is null → glowChangedBlocks no-ops. This covers the
            // null-workspace branch; the throw path is covered by the next test.
            expect(() => wrapper.instance().handleApply(turn)).not.toThrow();
            await flushPromises();
            expect(wrapper.instance().state.turns[0].status).toBe('applied');
        });

        test('a glow throw during Apply is swallowed — status stays applied (fail-open catch)', async () => {
            const vm = makeVm({});
            jest.spyOn(devConsole, 'applyProposal')
                .mockImplementation(() => Promise.resolve({ok: true, changedTopIds: ['hat-1']}));
            // Force runGlow's body to throw so its try/catch — the actual fail-open
            // guard — is the thing under test (not the null-workspace early return).
            jest.spyOn(glowModule, 'glowChangedBlocks').mockImplementation(() => {
                throw new Error('boom');
            });
            const wrapper = render(vm);
            const turn = {id: 6, role: 'ai', kind: 'proposal', status: 'pending', preview: makeProposal()};
            wrapper.setState({turns: [turn]});
            expect(() => wrapper.instance().handleApply(turn)).not.toThrow();
            await flushPromises();
            expect(wrapper.instance().state.turns[0].status).toBe('applied');
        });

        test('handleApply on a stale proposal marks the turn stale, no crash', async () => {
            const vm = makeVm({});
            jest.spyOn(devConsole, 'applyProposal')
                .mockImplementation(() => Promise.resolve({ok: false, stale: true}));
            const wrapper = render(vm);
            const turn = {id: 4, role: 'ai', kind: 'proposal', status: 'pending', preview: makeProposal()};
            wrapper.setState({turns: [turn]});
            wrapper.instance().handleApply(turn);
            await flushPromises();
            expect(wrapper.instance().state.turns[0].status).toBe('stale');
        });

        test('handleApply catch (non-atomic apply reject) marks the turn stale, no crash', async () => {
            const vm = makeVm({});
            jest.spyOn(devConsole, 'applyProposal')
                .mockImplementation(() => Promise.reject(new Error('mid-apply failure')));
            const wrapper = render(vm);
            const turn = {id: 5, role: 'ai', kind: 'proposal', status: 'pending', preview: makeProposal()};
            wrapper.setState({turns: [turn]});
            expect(() => wrapper.instance().handleApply(turn)).not.toThrow();
            await flushPromises();
            expect(wrapper.instance().state.turns[0].status).toBe('stale');
        });

        test('SINGLE-FLIGHT: two handleApply calls in the same tick inject only ONCE', async () => {
            const vm = makeVm({});
            const applySpy = jest.spyOn(devConsole, 'applyProposal')
                .mockImplementation(() => Promise.resolve({ok: true}));
            const wrapper = render(vm);
            const turn = {id: 6, role: 'ai', kind: 'proposal', status: 'pending', preview: makeProposal()};
            wrapper.setState({turns: [turn]});
            wrapper.instance().handleApply(turn);
            wrapper.instance().handleApply(turn); // child mashes Apply in the same tick
            await flushPromises();
            expect(applySpy).toHaveBeenCalledTimes(1);
        });

        test('M2 BUSY-LOCK: submit/runProposeFor is blocked while handleApply is in flight', async () => {
            const vm = makeVm({});
            // applyProposal never resolves — handleApply stays in flight
            jest.spyOn(devConsole, 'applyProposal')
                .mockImplementation(() => new Promise(function () {}));
            const proposeSpy = jest.spyOn(devConsole, 'propose')
                .mockImplementation(() => Promise.resolve({answer: 'ok'}));
            const wrapper = render(vm);
            const turn = {id: 11, role: 'ai', kind: 'proposal', status: 'pending', preview: makeProposal()};
            wrapper.setState({turns: [turn]});
            wrapper.instance().handleApply(turn); // starts apply, sets busy=true
            // runProposeFor checks this.state.busy — should be blocked
            wrapper.instance().runProposeFor('walk', 'sprite-a');
            await flushPromises();
            expect(proposeSpy).not.toHaveBeenCalled();
        });

        test('handleApply on a turn without a preview is a no-op', () => {
            const vm = makeVm({});
            const applySpy = jest.spyOn(devConsole, 'applyProposal')
                .mockImplementation(() => Promise.resolve({ok: true}));
            const wrapper = render(vm);
            wrapper.instance().handleApply({id: 7, role: 'ai', kind: 'answer'});
            expect(applySpy).not.toHaveBeenCalled();
        });

        test('handleIgnore marks the turn ignored (terminal)', () => {
            const vm = makeVm({});
            const saveSpy = jest.spyOn(chatStore, 'saveChat').mockReturnValue(true);
            const wrapper = render(vm);
            const turn = {id: 8, role: 'ai', kind: 'proposal', status: 'pending', preview: makeProposal()};
            wrapper.setState({turns: [turn]});
            wrapper.instance().handleIgnore(turn);
            expect(wrapper.instance().state.turns[0].status).toBe('ignored');
            expect(saveSpy).toHaveBeenCalled();
        });
    });

    describe('rebuild / make-it re-propose', () => {
        test('handleRebuild appends a NEW pending proposal, original turn unchanged', async () => {
            const vm = makeVm({});
            const proposeSpy = jest.spyOn(devConsole, 'propose')
                .mockImplementation(() => Promise.resolve({answer: '', proposal: makeProposal()}));
            const applyProposalSpy = jest.spyOn(devConsole, 'applyProposal')
                .mockImplementation(() => Promise.resolve({ok: true}));
            const wrapper = render(vm);
            const stale = {
                id: 9, role: 'ai', kind: 'proposal', status: 'stale',
                instruction: 'walk', targetId: 'sprite-a', preview: makeProposal()
            };
            wrapper.setState({turns: [stale]});
            wrapper.instance().handleRebuild(stale);
            await flushPromises();
            const {turns} = wrapper.instance().state;
            expect(turns).toHaveLength(2);
            expect(turns[0].status).toBe('stale'); // original untouched
            expect(turns[1]).toMatchObject({role: 'ai', kind: 'proposal', status: 'pending'});
            expect(proposeSpy.mock.calls[0][1]).toMatchObject({instruction: 'walk', targetId: 'sprite-a'});
            expect(applyProposalSpy).not.toHaveBeenCalled();
        });

        test('handleMakeIt on an answer turn appends a new pending proposal', async () => {
            const vm = makeVm({});
            jest.spyOn(devConsole, 'propose')
                .mockImplementation(() => Promise.resolve({answer: '', proposal: makeProposal()}));
            const applyProposalSpy = jest.spyOn(devConsole, 'applyProposal')
                .mockImplementation(() => Promise.resolve({ok: true}));
            const wrapper = render(vm);
            const answer = {id: 10, role: 'ai', kind: 'answer', text: 'you could...',
                instruction: 'make a game', targetId: 'sprite-a'};
            wrapper.setState({turns: [answer]});
            wrapper.instance().handleMakeIt(answer);
            await flushPromises();
            const {turns} = wrapper.instance().state;
            expect(turns).toHaveLength(2);
            expect(turns[0]).toMatchObject({kind: 'answer'}); // original untouched
            expect(turns[1]).toMatchObject({kind: 'proposal', status: 'pending'});
            expect(applyProposalSpy).not.toHaveBeenCalled();
        });
    });

    describe('target pinning (regression for the fail-closed fix)', () => {
        test('a mid-request sprite switch still targets the pinned sprite', async () => {
            const vm = makeVm({});
            const targetA = vm.editingTarget;
            const spriteB = {id: 'sprite-b', blocks: {}};
            vm.runtime.getTargetById = id => {
                if (id === 'sprite-a') return targetA;
                if (id === 'sprite-b') return spriteB;
                return null;
            };
            const proposeSpy = jest.spyOn(devConsole, 'propose')
                .mockImplementation(() => Promise.resolve({answer: 'ok'}));
            const wrapper = render(vm);
            wrapper.setState({instructionDraft: 'go'});
            wrapper.instance().handleSubmitInstruction(noopEvent);
            vm.editingTarget = spriteB; // child clicks sprite B while "Thinking…"
            await flushPromises();
            expect(proposeSpy).toHaveBeenCalledTimes(1);
            expect(proposeSpy.mock.calls[0][1].targetId).toBe('sprite-a');
        });

        test('a pinned sprite deleted mid-request fails closed (propose throws → error)', async () => {
            const vm = makeVm({});
            // propose itself throws when the pinned target no longer resolves.
            jest.spyOn(devConsole, 'propose')
                .mockImplementation(() => Promise.reject(new Error('propose: pinned target no longer exists')));
            const wrapper = render(vm);
            wrapper.setState({instructionDraft: 'go'});
            wrapper.instance().handleSubmitInstruction(noopEvent);
            await flushPromises();
            expect(wrapper.instance().state.error).toBe(true);
            expect(wrapper.instance().state.busy).toBe(false);
            // the user turn is still recorded; no ai turn was appended
            expect(wrapper.instance().state.turns).toHaveLength(1);
            expect(wrapper.instance().state.turns[0].role).toBe('user');
        });
    });

    describe('error and busy handling', () => {
        test('busy guard blocks a second concurrent submit', async () => {
            const vm = makeVm({});
            const proposeSpy = jest.spyOn(devConsole, 'propose')
                .mockImplementation(() => new Promise(() => {})); // never resolves → stays busy
            const wrapper = render(vm);
            wrapper.setState({instructionDraft: 'go'});
            wrapper.instance().handleSubmitInstruction(noopEvent);
            wrapper.instance().handleSubmitInstruction(noopEvent);
            await flushPromises();
            expect(proposeSpy).toHaveBeenCalledTimes(1);
        });

        test('a rejected propose sets error and clears busy, does not throw', async () => {
            const vm = makeVm({});
            jest.spyOn(devConsole, 'propose')
                .mockImplementation(() => Promise.reject(new Error('401')));
            const wrapper = render(vm);
            wrapper.setState({instructionDraft: 'go'});
            expect(() => wrapper.instance().handleSubmitInstruction(noopEvent)).not.toThrow();
            await flushPromises();
            expect(wrapper.instance().state.error).toBe(true);
            expect(wrapper.instance().state.busy).toBe(false);
        });

        test('editing the instruction clears a stale error', () => {
            const vm = makeVm({});
            const wrapper = render(vm);
            wrapper.setState({error: true});
            wrapper.instance().handleInstructionDraftChange({target: {value: 'x'}});
            expect(wrapper.instance().state.error).toBe(false);
            expect(wrapper.instance().state.instructionDraft).toBe('x');
        });

        test('try-again replays the PINNED target+instruction, not the current sprite', async () => {
            const vm = makeVm({});
            const targetA = vm.editingTarget;
            const spriteB = {id: 'sprite-b', blocks: {}};
            vm.runtime.getTargetById = id => {
                if (id === 'sprite-a') return targetA;
                if (id === 'sprite-b') return spriteB;
                return null;
            };
            const proposeSpy = jest.spyOn(devConsole, 'propose')
                .mockImplementationOnce(() => Promise.reject(new Error('401')))
                .mockImplementationOnce(() => Promise.resolve({answer: 'ok'}));
            const wrapper = render(vm);
            wrapper.setState({instructionDraft: 'walk'});
            wrapper.instance().handleSubmitInstruction(noopEvent);
            await flushPromises();
            expect(wrapper.instance().state.error).toBe(true);
            vm.editingTarget = spriteB; // child clicks sprite B after the error
            wrapper.instance().handleRetry();
            await flushPromises();
            expect(proposeSpy).toHaveBeenCalledTimes(2);
            expect(proposeSpy.mock.calls[1][1].targetId).toBe('sprite-a'); // pinned, not B
            expect(proposeSpy.mock.calls[1][1].instruction).toBe('walk'); // same instruction replayed
            expect(wrapper.instance().state.error).toBe(false);
        });

        test('retry pushes NO duplicate user turn (only the AI turn is appended)', async () => {
            const vm = makeVm({});
            jest.spyOn(devConsole, 'propose')
                .mockImplementationOnce(() => Promise.reject(new Error('401')))
                .mockImplementationOnce(() => Promise.resolve({answer: 'ok'}));
            const wrapper = render(vm);
            wrapper.setState({instructionDraft: 'walk'});
            wrapper.instance().handleSubmitInstruction(noopEvent);
            await flushPromises();
            // one user turn, propose failed → no ai turn yet
            expect(wrapper.instance().state.turns.filter(t => t.role === 'user')).toHaveLength(1);
            wrapper.instance().handleRetry();
            await flushPromises();
            // still exactly one user turn; retry only appended the ai turn
            expect(wrapper.instance().state.turns.filter(t => t.role === 'user')).toHaveLength(1);
            expect(wrapper.instance().state.turns.filter(t => t.role === 'ai')).toHaveLength(1);
        });

        test('handleRetry is a no-op when there is nothing to retry', () => {
            const vm = makeVm({});
            const proposeSpy = jest.spyOn(devConsole, 'propose')
                .mockImplementation(() => Promise.resolve({answer: 'ok'}));
            const wrapper = render(vm);
            wrapper.instance().handleRetry();
            expect(proposeSpy).not.toHaveBeenCalled();
        });

        test('handleRetry is a no-op while a request is already in flight', () => {
            const vm = makeVm({});
            const proposeSpy = jest.spyOn(devConsole, 'propose')
                .mockImplementation(() => Promise.resolve({answer: 'ok'}));
            const wrapper = render(vm);
            wrapper.setState({busy: true, lastInstruction: {instruction: 'walk', targetId: 'sprite-a'}});
            wrapper.instance().handleRetry();
            expect(proposeSpy).not.toHaveBeenCalled();
        });
    });

    describe('example chips', () => {
        test('clicking a chip sends it immediately (one-tap), clears error, closes the sheet', async () => {
            const vm = makeVm({});
            const proposeSpy = jest.spyOn(devConsole, 'propose')
                .mockImplementation(() => Promise.resolve({answer: 'ok', proposal: makeProposal()}));
            const wrapper = render(vm);
            wrapper.setState({error: true});
            wrapper.instance().handleToggleExamples();                       // open the sheet
            wrapper.instance().handleChipClick('Walk around');
            await flushPromises();
            const inst = wrapper.instance();
            expect(inst.state.turns.some(t => t.role === 'user' && t.text === 'Walk around')).toBe(true);
            expect(inst.state.instructionDraft).toBe('');                     // sent → draft cleared
            expect(inst.state.error).toBe(false);
            expect(inst.state.examplesOpen).toBe(false);                     // chip send closes the sheet
            expect(proposeSpy).toHaveBeenCalledTimes(1);
        });

        test('handleChipClick auto-sends the chip text (propose called once)', async () => {
            const vm = makeVm({});
            const proposeSpy = jest.spyOn(devConsole, 'propose')
                .mockImplementation(() => Promise.resolve({answer: 'ok', proposal: makeProposal()}));
            const wrapper = render(vm);
            wrapper.instance().handleChipClick('Say hello');
            await flushPromises();
            expect(proposeSpy).toHaveBeenCalledTimes(1);
            expect(wrapper.instance().state.turns.some(t => t.text === 'Say hello')).toBe(true);
        });
    });

    describe('key entry', () => {
        test('a successful saveKey switches to the ready state', () => {
            const vm = makeVm({});
            const wrapper = render(vm);
            wrapper.setState({keyDraft: 'sk-ant-new'});
            wrapper.instance().handleSubmitKey(noopEvent);
            expect(saveKey).toHaveBeenCalledWith('sk-ant-new');
            expect(wrapper.instance().state.apiKey).toBe('sk-ant-new');
            expect(wrapper.instance().state.keyDraft).toBe('');
            expect(wrapper.instance().state.error).toBe(false);
        });

        test('a rejected saveKey surfaces an error and keeps the draft', () => {
            const vm = makeVm({});
            saveKey.mockReturnValueOnce(false);
            const wrapper = render(vm);
            wrapper.setState({apiKey: '', keyDraft: 'sk-ant-x'});
            wrapper.instance().handleSubmitKey(noopEvent);
            expect(wrapper.instance().state.error).toBe(true);
            expect(wrapper.instance().state.apiKey).toBe(''); // did NOT advance to ready
            expect(wrapper.instance().state.keyDraft).toBe('sk-ant-x');
        });

        test('edit-key switches to editing mode WITHOUT clearing the key, blocked while busy', () => {
            const vm = makeVm({});
            const wrapper = render(vm);
            wrapper.setState({busy: true});
            wrapper.instance().handleEditKey();
            expect(wrapper.instance().state.editingKey).toBe(false); // blocked during a request

            wrapper.setState({busy: false});
            wrapper.instance().handleEditKey();
            expect(wrapper.instance().state.editingKey).toBe(true);
            expect(wrapper.instance().state.apiKey).toBe('sk-ant-test'); // key preserved
        });

        test('back-from-key cancels editing and keeps the key', () => {
            const vm = makeVm({});
            const wrapper = render(vm);
            wrapper.setState({editingKey: true});
            wrapper.instance().handleBackFromKey();
            expect(wrapper.instance().state.editingKey).toBe(false);
            expect(wrapper.instance().state.apiKey).toBe('sk-ant-test');
        });
    });

    describe('card resize', () => {
        test('resize-move from the SE corner grows width/height, position fixed', () => {
            const vm = makeVm({});
            const wrapper = render(vm);
            wrapper.setState({position: {x: 100, y: 80}});
            wrapper.instance().resizeCtx = {dir: 'se', left: 100, top: 80, right: 400, bottom: 400};
            wrapper.instance().handleResizeMove({clientX: 460, clientY: 500});
            expect(wrapper.instance().state.size).toEqual({w: 360, h: 420}); // 460-100, 500-80
            expect(wrapper.instance().state.position).toEqual({x: 100, y: 80}); // top-left fixed
        });

        test('resize-move from the NW corner moves the top-left and keeps the far edges', () => {
            const vm = makeVm({});
            const wrapper = render(vm);
            wrapper.instance().resizeCtx = {dir: 'nw', left: 100, top: 200, right: 400, bottom: 500};
            wrapper.instance().handleResizeMove({clientX: 60, clientY: 160});
            // far edges (right 400 / bottom 500) stay; top-left follows the mouse
            expect(wrapper.instance().state.position).toEqual({x: 60, y: 160});
            expect(wrapper.instance().state.size).toEqual({w: 340, h: 340}); // 400-60, 500-160
        });

        test('resize-move reads coordinates from a touch event (tablet)', () => {
            const vm = makeVm({});
            const wrapper = render(vm);
            wrapper.setState({position: {x: 100, y: 80}});
            wrapper.instance().resizeCtx = {dir: 'se', left: 100, top: 80, right: 400, bottom: 400};
            // A TouchEvent carries no clientX/clientY on itself — the point lives in
            // touches[0]. The handler must read from there for tablet resize to work.
            wrapper.instance().handleResizeMove({touches: [{clientX: 460, clientY: 500}]});
            expect(wrapper.instance().state.size).toEqual({w: 360, h: 420}); // 460-100, 500-80
            expect(wrapper.instance().state.position).toEqual({x: 100, y: 80}); // top-left fixed
        });

        test('touch resize registers a non-passive touchmove listener, prevents scroll, and cleans up', () => {
            const vm = makeVm({});
            jest.spyOn(uiPrefs, 'savePrefs').mockReturnValue(true);
            const wrapper = render(vm);
            const addSpy = jest.spyOn(window, 'addEventListener');
            const removeSpy = jest.spyOn(window, 'removeEventListener');
            const rect = {left: 100, top: 80, right: 400, bottom: 400};
            const start = {
                preventDefault: jest.fn(),
                stopPropagation: jest.fn(),
                touches: [{clientX: 100, clientY: 80}],
                currentTarget: {dataset: {dir: 'se'}, parentNode: {getBoundingClientRect: () => rect}}
            };
            wrapper.instance().handleResizeStart(start);
            // touchstart preventDefault suppresses the emulated mouse cascade
            expect(start.preventDefault).toHaveBeenCalled();
            const touchmoveCall = addSpy.mock.calls.find(c => c[0] === 'touchmove');
            expect(touchmoveCall).toBeDefined();
            expect(touchmoveCall[2]).toEqual({passive: false}); // required so move can preventDefault
            // a cancelable touchmove blocks the page from scrolling under the finger
            const move = {touches: [{clientX: 460, clientY: 500}], cancelable: true, preventDefault: jest.fn()};
            wrapper.instance().handleResizeMove(move);
            expect(move.preventDefault).toHaveBeenCalled();
            wrapper.instance().handleResizeStop();
            expect(removeSpy).toHaveBeenCalledWith('touchmove', wrapper.instance().handleResizeMove);
            addSpy.mockRestore();
            removeSpy.mockRestore();
        });

        test('resize-stop persists the size', () => {
            const vm = makeVm({});
            const saveSpy = jest.spyOn(uiPrefs, 'savePrefs').mockReturnValue(true);
            const wrapper = render(vm);
            wrapper.setState({position: {x: 0, y: 0}, size: {w: 360, h: 300}});
            wrapper.instance().handleResizeStop();
            expect(saveSpy).toHaveBeenCalledWith(
                expect.objectContaining({w: 360, h: 300})
            );
        });
    });

    describe('floating card prefs', () => {
        test('initial position falls back to defaultPosition when nothing stored', () => {
            const vm = makeVm({});
            jest.spyOn(uiPrefs, 'loadPrefs').mockReturnValue(null);
            const wrapper = render(vm);
            const {x, y} = wrapper.instance().state.position;
            expect(Number.isFinite(x)).toBe(true);
            expect(Number.isFinite(y)).toBe(true);
            expect(wrapper.instance().state.collapsed).toBe(false);
        });

        test('stored position is clamped into the viewport on init', () => {
            const vm = makeVm({});
            jest.spyOn(uiPrefs, 'loadPrefs').mockReturnValue({x: 99999, y: 99999, collapsed: true});
            const wrapper = render(vm);
            const {x, y} = wrapper.instance().state.position;
            expect(x).toBeLessThan(99999);
            expect(y).toBeLessThan(99999);
            expect(wrapper.instance().state.collapsed).toBe(true);
        });

        test('toggling collapse flips state and persists', () => {
            const vm = makeVm({});
            const saveSpy = jest.spyOn(uiPrefs, 'savePrefs').mockReturnValue(true);
            const wrapper = render(vm);
            const before = wrapper.instance().state.collapsed;
            wrapper.instance().handleToggleExamples();                       //+ open the sheet
            wrapper.instance().handleToggleCollapse();
            expect(wrapper.instance().state.collapsed).toBe(!before);
            expect(wrapper.instance().state.examplesOpen).toBe(false);       //+ collapse closes it
            expect(saveSpy).toHaveBeenCalled();
        });

        test('drag stop stores and persists the resting position (no re-clamp)', () => {
            const vm = makeVm({});
            const saveSpy = jest.spyOn(uiPrefs, 'savePrefs').mockReturnValue(true);
            const wrapper = render(vm);
            wrapper.instance().handleDragStop({}, {x: 120, y: 80});
            expect(wrapper.instance().state.position).toEqual({x: 120, y: 80});
            expect(saveSpy).toHaveBeenCalledWith(
                expect.objectContaining({x: 120, y: 80})
            );
        });

        test('a stored oversized/negative size is clamped into bounds on load', () => {
            const vm = makeVm({});
            jest.spyOn(uiPrefs, 'loadPrefs').mockReturnValue({x: 8, y: 48, collapsed: false, w: 99999, h: -50});
            const wrapper = render(vm);
            const {w, h} = wrapper.instance().state.size;
            expect(w).toBeLessThan(99999);
            expect(w).toBeGreaterThanOrEqual(240); // MIN_W
            expect(h).toBeGreaterThanOrEqual(160); // MIN_H (negative height clamped up)
        });

        test('window resize re-clamps a now-off-screen card back into view', () => {
            const vm = makeVm({});
            jest.spyOn(uiPrefs, 'loadPrefs').mockReturnValue(null);
            const wrapper = render(vm);
            wrapper.setState({position: {x: 5000, y: 5000}}); // simulate a shrunken window
            wrapper.instance().handleResize();
            const {x, y} = wrapper.instance().state.position;
            expect(x).toBeLessThan(5000);
            expect(y).toBeLessThan(5000);
        });

        test('onContextTurnsChange persists the FULL prefs object (regression guard)', () => {
            const vm = makeVm({});
            const saveSpy = jest.spyOn(uiPrefs, 'savePrefs').mockReturnValue(true);
            const wrapper = render(vm);
            wrapper.setState({position: {x: 12, y: 34}, collapsed: false, size: {w: 300, h: 200}});
            wrapper.instance().handleContextTurnsChange(6);
            expect(wrapper.instance().state.contextTurns).toBe(6);
            expect(saveSpy).toHaveBeenCalledWith(
                expect.objectContaining({x: 12, y: 34, collapsed: false, w: 300, h: 200, contextTurns: 6})
            );
        });
    });

    describe('chat history (turns + chat-store)', () => {
        test('a successful propose appends user+pending turns and calls saveChat', async () => {
            const vm = makeVm({});
            jest.spyOn(chatStore, 'loadChat').mockReturnValue([]);
            const saveSpy = jest.spyOn(chatStore, 'saveChat').mockReturnValue(true);
            jest.spyOn(devConsole, 'propose')
                .mockImplementation(() => Promise.resolve({answer: '', proposal: makeProposal()}));
            const wrapper = render(vm);
            wrapper.setState({instructionDraft: 'walk'});
            wrapper.instance().handleSubmitInstruction(noopEvent);
            await flushPromises();
            const {turns} = wrapper.instance().state;
            expect(turns).toHaveLength(2);
            expect(turns[0]).toMatchObject({role: 'user', text: 'walk'});
            expect(turns[1]).toMatchObject({role: 'ai', kind: 'proposal', status: 'pending'});
            expect(saveSpy).toHaveBeenCalled();
        });

        test('nextId is seeded from loaded turns (no id collision)', async () => {
            const vm = makeVm({});
            jest.spyOn(chatStore, 'loadChat').mockReturnValue([
                {id: 7, role: 'user', text: 'old'}
            ]);
            jest.spyOn(chatStore, 'saveChat').mockReturnValue(true);
            jest.spyOn(devConsole, 'propose')
                .mockImplementation(() => Promise.resolve({answer: 'ok'}));
            const wrapper = render(vm);
            wrapper.setState({instructionDraft: 'x'});
            wrapper.instance().handleSubmitInstruction(noopEvent);
            await flushPromises();
            const {turns} = wrapper.instance().state;
            expect(turns[1].id).toBe(8); // user turn seeded after id 7
        });

        test('a corrupt non-numeric id does not poison nextId', async () => {
            const vm = makeVm({});
            jest.spyOn(chatStore, 'loadChat').mockReturnValue([
                {id: 'bad', role: 'user', text: 'x'}
            ]);
            jest.spyOn(chatStore, 'saveChat').mockReturnValue(true);
            jest.spyOn(devConsole, 'propose')
                .mockImplementation(() => Promise.resolve({answer: 'ok'}));
            const wrapper = render(vm);
            wrapper.setState({instructionDraft: 'go'});
            wrapper.instance().handleSubmitInstruction(noopEvent);
            await flushPromises();
            const userTurn = wrapper.instance().state.turns.find(t => t.text === 'go');
            expect(Number.isFinite(userTurn.id)).toBe(true);
            expect(userTurn.id).toBe(0); // no finite ids present → counter starts at 0
        });

        test('clear empties turns and persists', () => {
            const vm = makeVm({});
            jest.spyOn(chatStore, 'loadChat').mockReturnValue([
                {id: 0, role: 'user', text: 'a'}
            ]);
            const saveSpy = jest.spyOn(chatStore, 'saveChat').mockReturnValue(true);
            const wrapper = render(vm);
            wrapper.instance().handleToggleExamples();                       //+ open the sheet
            wrapper.instance().handleClearHistory();
            expect(wrapper.instance().state.turns).toEqual([]);
            expect(wrapper.instance().state.examplesOpen).toBe(false);       //+ clear closes it
            expect(saveSpy).toHaveBeenCalledWith([]);
        });
    });

    describe('buildHistoryWindow', () => {
        test('returns last-N {role,text} only (no preview/baseStamp), length ≤ contextTurns*2', () => {
            const vm = makeVm({});
            const wrapper = render(vm);
            const many = [];
            for (let i = 0; i < 20; i++) {
                many.push(i % 2 === 0 ?
                    {id: i, role: 'user', text: `u${i}`} :
                    {id: i, role: 'ai', kind: 'proposal', text: `a${i}`,
                        preview: makeProposal(), baseStamp: {targetId: 'sprite-a', baseHash: 'H'}});
            }
            wrapper.setState({turns: many, contextTurns: 3});
            const win = wrapper.instance().buildHistoryWindow();
            expect(win).toHaveLength(6); // contextTurns*2
            win.forEach(entry => {
                expect(Object.keys(entry).sort()).toEqual(['role', 'text']);
                expect(entry.preview).toBeUndefined();
                expect(entry.baseStamp).toBeUndefined();
            });
        });

        test('returns [] when contextTurns is 0 (does not leak the whole transcript)', () => {
            const vm = makeVm({});
            const wrapper = render(vm);
            wrapper.setState({turns: [
                {id: 0, role: 'user', text: 'a'}, {id: 1, role: 'ai', kind: 'answer', text: 'b'},
                {id: 2, role: 'user', text: 'c'}, {id: 3, role: 'ai', kind: 'answer', text: 'd'}
            ], contextTurns: 0});
            expect(wrapper.instance().buildHistoryWindow()).toEqual([]);
        });
    });

    describe('redux wiring', () => {
        test('mapStateToProps passes state.scratchGui.vm to the container', () => {
            const vm = makeVm({});
            const store = configureStore()({scratchGui: {vm}});
            const wrapper = mountWithIntl(
                <Provider store={store}>
                    <VibePromptConnected />
                </Provider>
            );
            expect(wrapper.find('VibePrompt').prop('vm')).toBe(vm);
        });
    });

    describe('examples sheet', () => {
        test('examplesOpen defaults false and handleToggleExamples flips it', () => {
            const inst = render(makeVm({})).instance();
            expect(inst.state.examplesOpen).toBe(false);
            inst.handleToggleExamples();
            expect(inst.state.examplesOpen).toBe(true);
            inst.handleToggleExamples();
            expect(inst.state.examplesOpen).toBe(false);
        });

        test('submitting an instruction closes an open sheet', async () => {
            const vm = makeVm({});
            jest.spyOn(devConsole, 'propose')
                .mockImplementation(() => Promise.resolve({answer: 'ok', proposal: makeProposal()}));
            const wrapper = render(vm);
            wrapper.instance().handleToggleExamples();            // open
            wrapper.setState({instructionDraft: 'make the cat walk'});
            wrapper.instance().handleSubmitInstruction(noopEvent);
            await flushPromises();
            expect(wrapper.instance().state.examplesOpen).toBe(false);
        });
    });
});
