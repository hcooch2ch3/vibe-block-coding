import React from 'react';
import {shallow} from 'enzyme';
import {Provider} from 'react-redux';
import configureStore from 'redux-mock-store';

import {mountWithIntl} from '../../helpers/intl-helpers.jsx';
import VibePromptConnected, {VibePromptContainer} from '../../../src/containers/vibe-prompt';
import {saveKey, clearKey} from '../../../src/lib/ai-harness/key-store';
import * as devConsole from '../../../src/lib/ai-harness/dev-console';
import * as dsl from '../../../src/lib/ai-harness/dsl';
import * as uiPrefs from '../../../src/lib/ai-harness/ui-prefs';
import * as historyStore from '../../../src/lib/ai-harness/history-store';

// The real dsl.decompile is covered by test/unit/ai-harness/dsl.test.js; here it
// is mocked so these tests isolate the container's routing/guard logic. The mock
// key-store lets the container start in the "ready" (has-key) state.
jest.mock('../../../src/lib/ai-harness/key-store', () => ({
    loadKey: () => 'sk-ant-test',
    saveKey: jest.fn(() => true),
    clearKey: jest.fn()
}));

const flushPromises = () => new Promise(resolve => setImmediate(resolve));
const noopEvent = {preventDefault: () => {}};

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

    describe('instruction submission — generate/edit routing', () => {
        test('empty target routes to generate with the pinned targetId', async () => {
            const vm = makeVm({});
            jest.spyOn(dsl, 'decompile').mockReturnValue([]);
            const genSpy = jest.spyOn(devConsole, 'generate').mockImplementation(() => Promise.resolve([]));
            const editSpy = jest.spyOn(devConsole, 'edit').mockImplementation(() => Promise.resolve([]));
            const wrapper = render(vm);
            wrapper.setState({instructionDraft: 'make the cat walk'});
            wrapper.instance().handleSubmitInstruction(noopEvent);
            await flushPromises();
            expect(genSpy).toHaveBeenCalledTimes(1);
            expect(editSpy).not.toHaveBeenCalled();
            expect(genSpy.mock.calls[0][1].targetId).toBe('sprite-a');
            expect(vm.stopAll).toHaveBeenCalled();
        });

        test('decompile returning blocks routes to edit with the pinned targetId', async () => {
            const vm = makeVm({});
            jest.spyOn(dsl, 'decompile').mockReturnValue([{hat: 'when_flag', body: []}]);
            const genSpy = jest.spyOn(devConsole, 'generate').mockImplementation(() => Promise.resolve([]));
            const editSpy = jest.spyOn(devConsole, 'edit').mockImplementation(() => Promise.resolve([]));
            const wrapper = render(vm);
            wrapper.setState({instructionDraft: 'say hi too'});
            wrapper.instance().handleSubmitInstruction(noopEvent);
            await flushPromises();
            expect(editSpy).toHaveBeenCalledTimes(1);
            expect(genSpy).not.toHaveBeenCalled();
            expect(editSpy.mock.calls[0][1].targetId).toBe('sprite-a');
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
            jest.spyOn(dsl, 'decompile').mockReturnValue([]);
            const genSpy = jest.spyOn(devConsole, 'generate').mockImplementation(() => Promise.resolve([]));
            const wrapper = render(vm);
            wrapper.setState({instructionDraft: 'go'});
            wrapper.instance().handleSubmitInstruction(noopEvent);
            vm.editingTarget = spriteB; // child clicks sprite B while "Thinking…"
            await flushPromises();
            expect(genSpy).toHaveBeenCalledTimes(1);
            expect(genSpy.mock.calls[0][1].targetId).toBe('sprite-a');
        });

        test('a pinned sprite deleted mid-request fails closed (no mutation)', async () => {
            const vm = makeVm({});
            vm.runtime.getTargetById = () => null; // deletion: pinned id no longer resolves
            const decompileSpy = jest.spyOn(dsl, 'decompile');
            const genSpy = jest.spyOn(devConsole, 'generate').mockImplementation(() => Promise.resolve([]));
            const editSpy = jest.spyOn(devConsole, 'edit').mockImplementation(() => Promise.resolve([]));
            const wrapper = render(vm);
            wrapper.setState({instructionDraft: 'go'});
            wrapper.instance().handleSubmitInstruction(noopEvent);
            await flushPromises();
            expect(genSpy).not.toHaveBeenCalled();
            expect(editSpy).not.toHaveBeenCalled();
            expect(decompileSpy).not.toHaveBeenCalled(); // guard throws before detection
            expect(wrapper.instance().state.error).toBe(true);
        });
    });

    describe('error and busy handling', () => {
        test('busy guard blocks a second concurrent submit', async () => {
            const vm = makeVm({});
            jest.spyOn(dsl, 'decompile').mockReturnValue([]);
            const genSpy = jest.spyOn(devConsole, 'generate')
                .mockImplementation(() => new Promise(() => {})); // never resolves → stays busy
            const wrapper = render(vm);
            wrapper.setState({instructionDraft: 'go'});
            wrapper.instance().handleSubmitInstruction(noopEvent);
            wrapper.instance().handleSubmitInstruction(noopEvent);
            await flushPromises();
            expect(genSpy).toHaveBeenCalledTimes(1);
        });

        test('a decompile throw (non-OPMAP block) sets error and does not throw', async () => {
            const vm = makeVm({});
            // meaningful because detection runs INSIDE the chain — the old bug ran it
            // synchronously outside .catch, which would fail not.toThrow().
            jest.spyOn(dsl, 'decompile').mockImplementation(() => {
                throw new Error('역매핑 없음: control_wait');
            });
            jest.spyOn(devConsole, 'generate').mockImplementation(() => Promise.resolve([]));
            const wrapper = render(vm);
            wrapper.setState({instructionDraft: 'wait a bit'});
            expect(() => wrapper.instance().handleSubmitInstruction(noopEvent)).not.toThrow();
            await flushPromises();
            expect(wrapper.instance().state.error).toBe(true);
            expect(wrapper.instance().state.busy).toBe(false);
        });

        test('a rejected request sets error and clears busy', async () => {
            const vm = makeVm({});
            jest.spyOn(dsl, 'decompile').mockReturnValue([]);
            jest.spyOn(devConsole, 'generate').mockImplementation(() => Promise.reject(new Error('401')));
            const wrapper = render(vm);
            wrapper.setState({instructionDraft: 'go'});
            wrapper.instance().handleSubmitInstruction(noopEvent);
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

        test('try-again replays the PINNED target, not the current sprite', async () => {
            const vm = makeVm({});
            const targetA = vm.editingTarget;
            const spriteB = {id: 'sprite-b', blocks: {}};
            vm.runtime.getTargetById = id => {
                if (id === 'sprite-a') return targetA;
                if (id === 'sprite-b') return spriteB;
                return null;
            };
            jest.spyOn(dsl, 'decompile').mockReturnValue([]);
            const genSpy = jest.spyOn(devConsole, 'generate')
                .mockImplementationOnce(() => Promise.reject(new Error('401')))
                .mockImplementationOnce(() => Promise.resolve([]));
            const wrapper = render(vm);
            wrapper.setState({instructionDraft: 'walk'});
            wrapper.instance().handleSubmitInstruction(noopEvent);
            await flushPromises();
            expect(wrapper.instance().state.error).toBe(true);
            vm.editingTarget = spriteB; // child clicks sprite B after the error
            wrapper.instance().handleRetry();
            await flushPromises();
            expect(genSpy).toHaveBeenCalledTimes(2);
            expect(genSpy.mock.calls[1][1].targetId).toBe('sprite-a'); // pinned, not B
            expect(genSpy.mock.calls[1][1].instruction).toBe('walk'); // same instruction replayed
            expect(wrapper.instance().state.error).toBe(false);
        });

        test('handleRetry is a no-op when there is nothing to retry', () => {
            const vm = makeVm({});
            const genSpy = jest.spyOn(devConsole, 'generate').mockImplementation(() => Promise.resolve([]));
            const wrapper = render(vm);
            wrapper.instance().handleRetry();
            expect(genSpy).not.toHaveBeenCalled();
        });

        test('handleRetry is a no-op while a request is already in flight', () => {
            const vm = makeVm({});
            const genSpy = jest.spyOn(devConsole, 'generate').mockImplementation(() => Promise.resolve([]));
            const wrapper = render(vm);
            wrapper.setState({busy: true, lastInstruction: {instruction: 'walk', targetId: 'sprite-a'}});
            wrapper.instance().handleRetry();
            expect(genSpy).not.toHaveBeenCalled();
        });
    });

    describe('example chips', () => {
        test('clicking a chip fills the instruction draft and clears error', () => {
            const vm = makeVm({});
            const wrapper = render(vm);
            wrapper.setState({error: true, instructionDraft: ''});
            wrapper.instance().handleChipClick('Walk around');
            expect(wrapper.instance().state.instructionDraft).toBe('Walk around');
            expect(wrapper.instance().state.error).toBe(false);
        });

        test('handleChipClick does not send a request (fill only)', async () => {
            const vm = makeVm({});
            const genSpy = jest.spyOn(devConsole, 'generate').mockImplementation(() => Promise.resolve([]));
            const editSpy = jest.spyOn(devConsole, 'edit').mockImplementation(() => Promise.resolve([]));
            const wrapper = render(vm);
            wrapper.instance().handleChipClick('Say hello');
            await flushPromises();
            expect(genSpy).not.toHaveBeenCalled();
            expect(editSpy).not.toHaveBeenCalled();
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
            wrapper.instance().handleToggleCollapse();
            expect(wrapper.instance().state.collapsed).toBe(!before);
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
    });

    describe('chat history', () => {
        test('a successful generate appends a done entry with added changes', async () => {
            const vm = makeVm({});
            jest.spyOn(historyStore, 'loadHistory').mockReturnValue([]);
            const saveSpy = jest.spyOn(historyStore, 'saveHistory').mockReturnValue(true);
            jest.spyOn(dsl, 'decompile').mockReturnValue([]);
            jest.spyOn(devConsole, 'generate')
                .mockImplementation(() => Promise.resolve([{hat: 'when_flag', body: [['move', 10]]}]));
            const wrapper = render(vm);
            wrapper.setState({instructionDraft: 'walk'});
            wrapper.instance().handleSubmitInstruction(noopEvent);
            await flushPromises();
            const {history} = wrapper.instance().state;
            expect(history).toHaveLength(1);
            expect(history[0].status).toBe('done');
            expect(history[0].instruction).toBe('walk');
            expect(history[0].changes).toEqual([
                {kind: 'added', script: {hat: 'when_flag', body: [['move', 10]]}}
            ]);
            expect(saveSpy).toHaveBeenCalled();
        });

        test('a failed request appends a failed entry with no changes', async () => {
            const vm = makeVm({});
            jest.spyOn(historyStore, 'loadHistory').mockReturnValue([]);
            jest.spyOn(historyStore, 'saveHistory').mockReturnValue(true);
            jest.spyOn(dsl, 'decompile').mockReturnValue([]);
            jest.spyOn(devConsole, 'generate').mockImplementation(() => Promise.reject(new Error('401')));
            const wrapper = render(vm);
            wrapper.setState({instructionDraft: 'walk'});
            wrapper.instance().handleSubmitInstruction(noopEvent);
            await flushPromises();
            const {history} = wrapper.instance().state;
            expect(history).toHaveLength(1);
            expect(history[0].status).toBe('failed');
            expect(history[0].changes).toEqual([]);
        });

        test('nextHistoryId is seeded from loaded history (no id collision)', async () => {
            const vm = makeVm({});
            jest.spyOn(historyStore, 'loadHistory').mockReturnValue([
                {id: 7, instruction: 'old', changes: [], status: 'done'}
            ]);
            jest.spyOn(historyStore, 'saveHistory').mockReturnValue(true);
            jest.spyOn(dsl, 'decompile').mockReturnValue([]);
            jest.spyOn(devConsole, 'generate').mockImplementation(() => Promise.resolve([]));
            const wrapper = render(vm);
            wrapper.setState({instructionDraft: 'x'});
            wrapper.instance().handleSubmitInstruction(noopEvent);
            await flushPromises();
            const {history} = wrapper.instance().state;
            expect(history[history.length - 1].id).toBe(8);
        });

        test('a corrupt non-numeric id does not poison nextHistoryId', async () => {
            const vm = makeVm({});
            jest.spyOn(historyStore, 'loadHistory').mockReturnValue([
                {id: 'bad', instruction: 'x', changes: [], status: 'done'}
            ]);
            jest.spyOn(historyStore, 'saveHistory').mockReturnValue(true);
            jest.spyOn(dsl, 'decompile').mockReturnValue([]);
            jest.spyOn(devConsole, 'generate').mockImplementation(() => Promise.resolve([]));
            const wrapper = render(vm);
            wrapper.setState({instructionDraft: 'go'});
            wrapper.instance().handleSubmitInstruction(noopEvent);
            await flushPromises();
            const {history} = wrapper.instance().state;
            const last = history[history.length - 1];
            expect(Number.isFinite(last.id)).toBe(true);
            expect(last.id).toBe(0); // no finite ids present → counter starts at 0
        });

        test('clear empties history and persists', () => {
            const vm = makeVm({});
            jest.spyOn(historyStore, 'loadHistory').mockReturnValue([
                {id: 0, instruction: 'a', changes: [], status: 'done'}
            ]);
            const saveSpy = jest.spyOn(historyStore, 'saveHistory').mockReturnValue(true);
            const wrapper = render(vm);
            wrapper.instance().handleClearHistory();
            expect(wrapper.instance().state.history).toEqual([]);
            expect(saveSpy).toHaveBeenCalledWith([]);
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
});
