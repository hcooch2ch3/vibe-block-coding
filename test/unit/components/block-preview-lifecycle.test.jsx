import React from 'react';
import {mount} from 'enzyme';

// The plain grip-math tests (block-preview.test.jsx) use shallow, so Blockly
// never injects. Here we MOUNT with a stubbed scratch-blocks so the real risk
// surface, inject/measure/anchor/svgResize/dispose and the mainWorkspace
// snapshot-restore, is exercised and guarded against regression. Each test
// gets a fresh module (resetModules) so BlockPreview's memoized SB cache is
// clean and per-test stub behavior isn't leaked.
const SENTINEL = {name: 'editor-main-workspace'};
const SCRIPT = {hat: 'when_flag', body: [['move', 10]]};

let BlockPreview, VMScratchBlocks, fakeSB, fakeWs, fakeBlock;

const setupBlocks = () => {
    fakeBlock = {moveBy: jest.fn()};
    fakeWs = {
        getTopBlocks: () => [fakeBlock],
        getBlocksBoundingBox: () => ({x: 0, y: 0, width: 200, height: 300}),
        scale: 0.7,
        dispose: jest.fn()
    };
    fakeSB = {
        mainWorkspace: SENTINEL,
        inject: jest.fn(() => fakeWs),
        svgResize: jest.fn(),
        Xml: {textToDom: () => ({}), domToWorkspace: jest.fn()}
    };
};

beforeEach(() => {
    jest.resetModules();
    setupBlocks();
    jest.doMock('../../../src/lib/blocks', () => jest.fn(() => fakeSB));
    VMScratchBlocks = require('../../../src/lib/blocks');
    BlockPreview = require('../../../src/components/vibe-prompt/block-preview.jsx').default;
});

afterEach(() => {
    jest.resetModules();
});

describe('BlockPreview Blockly lifecycle', () => {
    test('mount measures content height, anchors the stack top-left, restores mainWorkspace, and svgResizes', () => {
        const wrapper = mount(<BlockPreview script={SCRIPT} variant="added" vm={{}} />);
        const inst = wrapper.instance();
        expect(VMScratchBlocks).toHaveBeenCalled();
        // contentH = ceil((bbox.y + bbox.height) * scale) + CONTENT_PAD = ceil(300*0.7)+12
        expect(inst.state.contentH).toBe(222);
        // the stack's bounding-box origin is normalized to (TOP_MARGIN, TOP_MARGIN)
        expect(fakeBlock.moveBy).toHaveBeenCalledWith(24, 24);
        // the shared Blockly singleton is restored, NOT left pointing at the preview
        expect(fakeSB.mainWorkspace).toBe(SENTINEL);
        // svgResize fires after the contentH commit so the SVG matches the tall canvas
        expect(fakeSB.svgResize).toHaveBeenCalledWith(fakeWs);
        wrapper.unmount();
        expect(fakeWs.dispose).toHaveBeenCalledTimes(1);
    });

    test('a throw during injection still restores mainWorkspace and disposes the workspace (no leak, no corruption)', () => {
        fakeSB.Xml.domToWorkspace = jest.fn(() => {
            throw new Error('boom');
        });
        const wrapper = mount(<BlockPreview script={SCRIPT} variant="added" vm={{}} />);
        // finally-block restores even though injection threw
        expect(fakeSB.mainWorkspace).toBe(SENTINEL);
        // the workspace that injected before the throw is disposed (no orphan)
        expect(fakeWs.dispose).toHaveBeenCalledTimes(1);
        expect(wrapper.instance().state.contentH).toBe(null);
        wrapper.unmount();
    });

    test('default frame height auto-fits content up to the cap', () => {
        const wrapper = mount(<BlockPreview script={SCRIPT} variant="added" vm={{}} />);
        // contentH 222 > DEFAULT_CAP_H → capped
        expect(wrapper.instance().frameHeight()).toBe(140);
    });

    test('short content sets the frame to the content height (no cap, no empty gutter)', () => {
        fakeWs.getBlocksBoundingBox = () => ({x: 0, y: 0, width: 100, height: 60});
        const wrapper = mount(<BlockPreview script={SCRIPT} variant="added" vm={{}} />);
        // contentH = ceil(60*0.7)+12 = 54, below the cap → frame == content
        expect(wrapper.instance().state.contentH).toBe(54);
        expect(wrapper.instance().frameHeight()).toBe(54);
    });
});
