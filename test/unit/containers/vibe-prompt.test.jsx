import React from 'react';
import {shallow} from 'enzyme';
import {Provider} from 'react-redux';
import configureStore from 'redux-mock-store';

import {mountWithIntl} from '../../helpers/intl-helpers.jsx';
import VibePromptConnected, {VibePromptContainer} from '../../../src/containers/vibe-prompt';
import {saveKey, clearKey} from '../../../src/lib/ai-harness/key-store';
import * as devConsole from '../../../src/lib/ai-harness/dev-console';
import * as dsl from '../../../src/lib/ai-harness/dsl';

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

        test('reset clears the key, but is blocked while busy', () => {
            const vm = makeVm({});
            const wrapper = render(vm);
            wrapper.setState({busy: true});
            wrapper.instance().handleResetKey();
            expect(clearKey).not.toHaveBeenCalled(); // blocked during a request

            wrapper.setState({busy: false});
            wrapper.instance().handleResetKey();
            expect(clearKey).toHaveBeenCalled();
            expect(wrapper.instance().state.apiKey).toBe('');
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
