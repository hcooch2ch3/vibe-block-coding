import React from 'react';
import {mountWithIntl} from '../../helpers/intl-helpers.jsx';
import VibePromptComponent from '../../../src/components/vibe-prompt/vibe-prompt.jsx';

const baseProps = {
    hasKey: false, busy: false, error: false, canCancelKey: true,
    keyDraft: '', instructionDraft: '', collapsed: false,
    position: {x: 0, y: 0}, size: {w: 300, h: null}, turns: [],
    contextTurns: 3,
    onContextTurnsChange: jest.fn(),
    onKeyDraftChange: jest.fn(), onInstructionDraftChange: jest.fn(),
    onSubmitKey: jest.fn(), onSubmitInstruction: jest.fn(), onEditKey: jest.fn(),
    onChipClick: jest.fn(), onRetry: jest.fn(), onClearHistory: jest.fn(),
    onToggleCollapse: jest.fn(), onDragStop: jest.fn(), onCancelKey: jest.fn(),
    onResizeStart: jest.fn()
};

test('the memory slider is not shown in the instruction view (hasKey)', () => {
    const wrapper = mountWithIntl(
        <VibePromptComponent {...baseProps} hasKey />
    );
    expect(wrapper.find('.vibe-memory-slider')).toHaveLength(0);
});

test('the memory slider in the settings view reports changes via onContextTurnsChange', () => {
    const onContextTurnsChange = jest.fn();
    const wrapper = mountWithIntl(
        <VibePromptComponent {...baseProps} onContextTurnsChange={onContextTurnsChange} />
    );
    const slider = wrapper.find('.vibe-memory-slider').first();
    expect(slider).toHaveLength(1);
    slider.simulate('change', {target: {value: '5'}});
    expect(onContextTurnsChange).toHaveBeenCalledWith(5);   // Number, not '5'
});
