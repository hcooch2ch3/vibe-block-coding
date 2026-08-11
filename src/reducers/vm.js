import VM from 'scratch-vm';
import storage from '../lib/storage';
import {installDevConsole} from '../lib/ai-harness/dev-console';

const SET_VM = 'scratch-gui/vm/SET_VM';
const defaultVM = new VM();
defaultVM.attachStorage(storage);
const initialState = defaultVM;

// Dev-mode only: exposes the AI block-injection and generate/edit loop for console experiments.
// window.vm = the vm instance, window.vibe = the AI pipeline (generate/edit/smoke).
if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
    window.vm = defaultVM;
    installDevConsole(defaultVM);
}

const reducer = function (state, action) {
    if (typeof state === 'undefined') state = initialState;
    switch (action.type) {
    case SET_VM:
        return action.vm;
    default:
        return state;
    }
};
const setVM = function (vm) {
    return {
        type: SET_VM,
        vm: vm
    };
};

export {
    reducer as default,
    initialState as vmInitialState,
    setVM
};
