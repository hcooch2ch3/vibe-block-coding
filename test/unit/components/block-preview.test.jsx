import React from 'react';
import {shallow} from 'enzyme';

import BlockPreview from '../../../src/components/vibe-prompt/block-preview.jsx';

// A minimal script; Blockly never renders under jsdom + shallow (no real ref),
// so these tests exercise only the resize-grip math, not the block rendering.
const script = {hat: 'when_flag', body: [['move', 10]]};
const make = () => shallow(<BlockPreview script={script} variant="added" vm={{}} />);

describe('BlockPreview resize grip', () => {
    test('dragging the grip down grows the box height by the drag delta', () => {
        const inst = make().instance();
        inst.gripCtx = {startY: 100, startH: 88};
        inst.handleGripMove({clientY: 160});
        expect(inst.state.boxH).toBe(148); // 88 + (160 - 100)
    });

    test('box height is clamped to a minimum (cannot collapse to nothing)', () => {
        const inst = make().instance();
        inst.gripCtx = {startY: 100, startH: 88};
        inst.handleGripMove({clientY: 0}); // 88 - 100 = -12 → clamped up
        expect(inst.state.boxH).toBe(44); // MIN_BOX_H
    });

    test('grip drag reads coordinates from a touch event (tablet)', () => {
        const inst = make().instance();
        inst.gripCtx = {startY: 100, startH: 88};
        inst.handleGripMove({touches: [{clientY: 200}]});
        expect(inst.state.boxH).toBe(188); // 88 + (200 - 100)
    });

    test('grip start captures the height and registers a non-passive touchmove, cleaned up on stop', () => {
        const inst = make().instance();
        const addSpy = jest.spyOn(window, 'addEventListener');
        const removeSpy = jest.spyOn(window, 'removeEventListener');
        const start = {preventDefault: jest.fn(), stopPropagation: jest.fn(), touches: [{clientY: 50}]};
        inst.handleGripStart(start);
        expect(start.preventDefault).toHaveBeenCalled();
        expect(inst.gripCtx.startY).toBe(50);
        const touchmoveCall = addSpy.mock.calls.find(c => c[0] === 'touchmove');
        expect(touchmoveCall).toBeDefined();
        expect(touchmoveCall[2]).toEqual({passive: false});
        inst.handleGripStop();
        expect(removeSpy).toHaveBeenCalledWith('touchmove', inst.handleGripMove);
        expect(inst.gripCtx).toBe(null);
        addSpy.mockRestore();
        removeSpy.mockRestore();
    });
});
