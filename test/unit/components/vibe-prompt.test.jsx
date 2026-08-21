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

test('the settings view offers a source-code link to the AGPL repository', () => {
    // AGPL-3.0 section 13: network users must be offered the Corresponding Source.
    // The settings screen is reached by every first-time user and re-openable via the
    // gear, so the offer lives here.
    const wrapper = mountWithIntl(
        <VibePromptComponent {...baseProps} hasKey={false} />
    );
    const link = wrapper.find('a.vibe-source-link').hostNodes();
    expect(link).toHaveLength(1);
    expect(link.prop('href')).toBe('https://github.com/hcooch2ch3/vibe-block-coding');
    expect(link.prop('target')).toBe('_blank');
    // new-tab links must not leak window.opener to the destination
    expect(link.prop('rel')).toContain('noopener');
});

// The settings screen reads modeDraft (the tab the user is browsing), never the
// committed mode. Nothing else in the suite renders this component with the two
// diverging, so without these the whole component half of the draft split can be
// reverted silently.
const pressedTab = wrapper => wrapper.find('button[aria-pressed=true]').hostNodes();
const buttonsSaying = (wrapper, text) => wrapper.findWhere(
    n => n.type() === 'button' && n.text().trim() === text
).hostNodes();
const backButtons = wrapper => wrapper.findWhere(
    n => n.type() === 'button' && n.text().trim().charAt(0) === '\u2039'
).hostNodes();

test('the settings tabs follow modeDraft, not the committed mode', () => {
    const wrapper = mountWithIntl(
        <VibePromptComponent {...baseProps} hasKey={false} mode="free" modeDraft="key" />
    );
    const on = pressedTab(wrapper);
    expect(on).toHaveLength(1);
    expect(on.text().trim()).toBe('My key');
});

test('the settings panel follows modeDraft, not the committed mode', () => {
    const wrapper = mountWithIntl(
        <VibePromptComponent {...baseProps} hasKey={false} mode="free" modeDraft="key" />
    );
    // key panel is up...
    expect(wrapper.find('input[placeholder="Paste your API key (sk-ant-...)"]').hostNodes())
        .toHaveLength(1);
    // ...and neither of the other two panels leaked through on the committed mode
    expect(buttonsSaying(wrapper, 'Start')).toHaveLength(0);
    expect(wrapper.find('input[placeholder="Server URL (https://\u2026)"]').hostNodes())
        .toHaveLength(0);
});

test('the server panel follows modeDraft too', () => {
    const wrapper = mountWithIntl(
        <VibePromptComponent {...baseProps} hasKey={false} mode="free" modeDraft="server" />
    );
    expect(wrapper.find('input[placeholder="Server URL (https://\u2026)"]').hostNodes())
        .toHaveLength(1);
    expect(buttonsSaying(wrapper, 'Start')).toHaveLength(0);
});

test('the Back button renders from canCancelKey', () => {
    const shown = mountWithIntl(
        <VibePromptComponent {...baseProps} hasKey={false} canCancelKey />
    );
    expect(backButtons(shown)).toHaveLength(1);

    const hidden = mountWithIntl(
        <VibePromptComponent {...baseProps} hasKey={false} canCancelKey={false} />
    );
    expect(backButtons(hidden)).toHaveLength(0);
});

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

test('the gear button appears only with a key AND expanded', () => {
    // Collapsed hides the body, so a gear click would swap to a settings screen
    // nobody can see. The header keeps only the status dot and the expand toggle.
    const shown = mountWithIntl(<VibePromptComponent {...baseProps} hasKey />);
    expect(shown.find('.vibe-gear-btn').hostNodes().length).toBe(1);

    const collapsed = mountWithIntl(
        <VibePromptComponent {...baseProps} hasKey collapsed />
    );
    expect(collapsed.find('.vibe-gear-btn').hostNodes().length).toBe(0);
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

test('the scrim tap and Escape each close the examples panel', () => {
    const turns = [{id: 0, role: 'user', text: 'hi'}];
    const openSheet = () => {
        const onToggleExamples = jest.fn();
        const wrapper = mountWithIntl(
            <VibePromptComponent {...baseProps} hasKey turns={turns} examplesOpen onToggleExamples={onToggleExamples} />
        );
        return {wrapper, onToggleExamples};
    };

    const s = openSheet();
    s.wrapper.find('button[aria-label="Dismiss examples"]').first().simulate('click'); // the scrim
    expect(s.onToggleExamples).toHaveBeenCalledTimes(1);
    s.wrapper.unmount();

    const esc = openSheet();
    document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}));
    expect(esc.onToggleExamples).toHaveBeenCalledTimes(1);
    esc.wrapper.unmount();
});

test('the open bottom sheet is a modal dialog (role, aria-modal, focusable)', () => {
    const turns = [{id: 0, role: 'user', text: 'hi'}];
    const wrapper = mountWithIntl(
        <VibePromptComponent {...baseProps} hasKey turns={turns} examplesOpen />
    );
    const sheet = wrapper.find('.vibe-example-sheet').first();
    // B2 covers the composer, so it IS modal now.
    expect(sheet.prop('role')).toBe('dialog');
    expect(sheet.prop('aria-modal')).toBe('true');
    expect(sheet.prop('tabIndex')).toBe(-1);
    wrapper.unmount();
});

test('dragging the grabber down past the threshold closes the sheet', () => {
    const turns = [{id: 0, role: 'user', text: 'hi'}];
    const onToggleExamples = jest.fn();
    const wrapper = mountWithIntl(
        <VibePromptComponent {...baseProps} hasKey turns={turns} examplesOpen onToggleExamples={onToggleExamples} />
    );
    wrapper.find('.vibe-sheet-grabber').first().simulate('mousedown', {clientY: 100});
    window.dispatchEvent(new MouseEvent('mousemove', {clientY: 200})); // +100px (> 72)
    window.dispatchEvent(new MouseEvent('mouseup'));
    // Exactly once matters: onClose is a TOGGLE (handleToggleExamples), so a double-fire
    // would REOPEN the sheet, not just no-op.
    expect(onToggleExamples).toHaveBeenCalledTimes(1);
    wrapper.unmount();
});

test('a touch drag on the grabber past the threshold closes the sheet', () => {
    const turns = [{id: 0, role: 'user', text: 'hi'}];
    const onToggleExamples = jest.fn();
    const wrapper = mountWithIntl(
        <VibePromptComponent {...baseProps} hasKey turns={turns} examplesOpen onToggleExamples={onToggleExamples} />
    );
    // touchstart carries its point in touches[0]; cancelable so the emulated-mouse guard
    // (preventDefault) runs, proving the touch branch, not just the mouse path.
    wrapper.find('.vibe-sheet-grabber').first().simulate('touchstart', {
        cancelable: true, preventDefault () {}, touches: [{clientY: 100}]
    });
    const move = new Event('touchmove', {cancelable: true});
    move.touches = [{clientY: 200}]; // +100px (> 72)
    window.dispatchEvent(move);
    window.dispatchEvent(new Event('touchend'));
    expect(onToggleExamples).toHaveBeenCalledTimes(1);
    wrapper.unmount();
});

test('a small grabber drag snaps back and does NOT close', () => {
    const turns = [{id: 0, role: 'user', text: 'hi'}];
    const onToggleExamples = jest.fn();
    const wrapper = mountWithIntl(
        <VibePromptComponent {...baseProps} hasKey turns={turns} examplesOpen onToggleExamples={onToggleExamples} />
    );
    wrapper.find('.vibe-sheet-grabber').first().simulate('mousedown', {clientY: 100});
    window.dispatchEvent(new MouseEvent('mousemove', {clientY: 130})); // +30px (< 72)
    window.dispatchEvent(new MouseEvent('mouseup'));
    expect(onToggleExamples).not.toHaveBeenCalled();
    wrapper.unmount();
});
