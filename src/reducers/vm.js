import VM from 'scratch-vm';
import storage from '../lib/storage';

const SET_VM = 'scratch-gui/vm/SET_VM';
const defaultVM = new VM();
defaultVM.attachStorage(storage);
const initialState = defaultVM;

// 개발 모드 전용: 콘솔에서 AI 블록 주입을 실험할 수 있게 vm 인스턴스를 window에 노출
if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
    window.vm = defaultVM;
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
