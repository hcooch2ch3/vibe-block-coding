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
    onResizeStart: jest.fn(),
    onToggleExamples: jest.fn(), examplesOpen: false
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

test('welcome examples show only on an empty chat (hasKey)', () => {
    const wrapper = mountWithIntl(
        <VibePromptComponent {...baseProps} hasKey turns={[]} />
    );
    expect(wrapper.find('.vibe-example-chip').hostNodes().length).toBe(3);
});

test('welcome examples are hidden once the chat has history', () => {
    const turns = [{id: 0, role: 'user', text: 'hi'}];
    const wrapper = mountWithIntl(
        <VibePromptComponent {...baseProps} hasKey turns={turns} />
    );
    expect(wrapper.find('.vibe-example-chip').hostNodes().length).toBe(0);
});

test('clicking a welcome example reports the plain label (no emoji)', () => {
    const onChipClick = jest.fn();
    const wrapper = mountWithIntl(
        <VibePromptComponent {...baseProps} hasKey turns={[]} onChipClick={onChipClick} />
    );
    wrapper.find('.vibe-example-chip').hostNodes().first().simulate('click');
    expect(onChipClick).toHaveBeenCalledWith('Walk around');
});

test('the examples button appears only with a key, expanded, and history', () => {
    const turns = [{id: 0, role: 'user', text: 'hi'}];
    const shown = mountWithIntl(<VibePromptComponent {...baseProps} hasKey turns={turns} />);
    expect(shown.find('.vibe-examples-btn').length).toBe(1);

    const empty = mountWithIntl(<VibePromptComponent {...baseProps} hasKey turns={[]} />);
    expect(empty.find('.vibe-examples-btn').length).toBe(0);

    const collapsed = mountWithIntl(
        <VibePromptComponent {...baseProps} hasKey collapsed turns={turns} />
    );
    expect(collapsed.find('.vibe-examples-btn').length).toBe(0);
});

test('clicking the examples button calls onToggleExamples', () => {
    const onToggleExamples = jest.fn();
    const turns = [{id: 0, role: 'user', text: 'hi'}];
    const wrapper = mountWithIntl(
        <VibePromptComponent {...baseProps} hasKey turns={turns} onToggleExamples={onToggleExamples} />
    );
    wrapper.find('.vibe-examples-btn').first().simulate('click');
    expect(onToggleExamples).toHaveBeenCalled();
});

test('the examples sheet renders only when open AND history exists', () => {
    const turns = [{id: 0, role: 'user', text: 'hi'}];
    const closed = mountWithIntl(
        <VibePromptComponent {...baseProps} hasKey turns={turns} examplesOpen={false} />
    );
    expect(closed.find('.vibe-example-sheet').length).toBe(0);
    closed.unmount();

    const open = mountWithIntl(
        <VibePromptComponent {...baseProps} hasKey turns={turns} examplesOpen />
    );
    expect(open.find('.vibe-example-sheet').length).toBe(1);
    expect(open.find('.vibe-example-chip').hostNodes().length).toBe(3);   // chips live in the sheet
    open.unmount();

    const openEmpty = mountWithIntl(
        <VibePromptComponent {...baseProps} hasKey turns={[]} examplesOpen />
    );
    expect(openEmpty.find('.vibe-example-sheet').length).toBe(0);   // no sheet without history
    openEmpty.unmount();
});

test('the ✕ and Escape each close the examples panel', () => {
    const turns = [{id: 0, role: 'user', text: 'hi'}];
    const openSheet = () => {
        const onToggleExamples = jest.fn();
        const wrapper = mountWithIntl(
            <VibePromptComponent {...baseProps} hasKey turns={turns} examplesOpen onToggleExamples={onToggleExamples} />
        );
        return {wrapper, onToggleExamples};
    };

    const x = openSheet();
    x.wrapper.find('button[aria-label="Close examples"]').first().simulate('click'); // the ✕
    expect(x.onToggleExamples).toHaveBeenCalledTimes(1);
    x.wrapper.unmount();

    const esc = openSheet();
    document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}));
    expect(esc.onToggleExamples).toHaveBeenCalledTimes(1);
    esc.wrapper.unmount(); // detach the document keydown listener
});

test('the open examples panel is a labeled, focusable inline group', () => {
    // Focus MOVEMENT (into the panel on open, back to 💡 on close) is NOT asserted
    // here: mountWithIntl mounts detached (no attachTo), so document.activeElement
    // does not track — that behavior is covered by manual QA. This test locks the
    // a11y STRUCTURE so it can't silently regress.
    const turns = [{id: 0, role: 'user', text: 'hi'}];
    const wrapper = mountWithIntl(
        <VibePromptComponent {...baseProps} hasKey turns={turns} examplesOpen />
    );
    const sheet = wrapper.find('.vibe-example-sheet').first();
    // Inline disclosure (A2), not a modal dialog: role=group, never aria-modal.
    expect(sheet.prop('role')).toBe('group');
    expect(sheet.prop('aria-modal')).toBeUndefined();
    expect(sheet.prop('tabIndex')).toBe(-1);
    wrapper.unmount();
});

test('the composer stays usable while the examples sheet is open', () => {
    // Complaint-B invariant: the sheet floats over the conversation area only; the
    // composer input is never disabled or covered by the sheet (busy is false here).
    const turns = [{id: 0, role: 'user', text: 'hi'}];
    const wrapper = mountWithIntl(
        <VibePromptComponent {...baseProps} hasKey turns={turns} examplesOpen />
    );
    expect(wrapper.find('.vibe-example-sheet').length).toBe(1);
    expect(wrapper.find('input').first().prop('disabled')).toBeFalsy();
    wrapper.unmount();
});
