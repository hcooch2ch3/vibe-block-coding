import PropTypes from 'prop-types';
import React from 'react';
import {defineMessages, injectIntl, intlShape} from 'react-intl';
import classNames from 'classnames';
import Draggable from 'react-draggable';

import HistoryList from './history-list.jsx';
import MemorySlider from './memory-slider.jsx';
import styles from './vibe-prompt.css';

const memoryMessages = defineMessages({
    memoryLabel: {
        id: 'vibe.prompt.memoryLabel',
        defaultMessage: '💬 Conversation memory',
        description: 'Label for the conversation-memory depth slider'
    },
    memoryHint: {
        id: 'vibe.prompt.memoryHint',
        defaultMessage: 'How many past turns the AI remembers.',
        description: 'Hint under the conversation-memory slider'
    }
});

// Module-level noop used as defaultProp for onContextTurnsChange (avoids
// inline arrow in JSX which react/jsx-no-bind forbids).
const noop = () => {};

const messages = defineMessages({
    keyPlaceholder: {
        id: 'vibe.prompt.keyPlaceholder',
        defaultMessage: 'Paste your API key (sk-ant-...)',
        description: 'Placeholder for the BYOK API key input'
    },
    keyNotice: {
        id: 'vibe.prompt.keyNotice',
        defaultMessage: 'Your key is stored only in this browser. Use a low-budget key.',
        description: 'Notice explaining that the API key stays local'
    },
    saveKey: {
        id: 'vibe.prompt.saveKey',
        defaultMessage: 'Save key',
        description: 'Button to save the API key'
    },
    instructionPlaceholder: {
        id: 'vibe.prompt.instructionPlaceholder',
        defaultMessage: 'Tell me what to make…',
        description: 'Placeholder for the natural-language instruction input'
    },
    send: {
        id: 'vibe.prompt.send',
        defaultMessage: 'Send',
        description: 'Button to send the instruction to the AI'
    },
    resetKey: {
        id: 'vibe.prompt.resetKey',
        defaultMessage: 'Change API key',
        description: 'Tooltip for the gear button that resets the API key'
    },
    working: {
        id: 'vibe.prompt.working',
        defaultMessage: 'Thinking…',
        description: 'Shown while the AI request is in flight'
    },
    error: {
        id: 'vibe.prompt.error',
        defaultMessage: 'Oops, that did not work. Want to try again?',
        description: 'Friendly error message when a request fails'
    },
    saveKeyError: {
        id: 'vibe.prompt.saveKeyError',
        defaultMessage: 'Could not save your key in this browser. Try again?',
        description: 'Shown when the API key could not be written to storage'
    },
    chipWalk: {
        id: 'vibe.prompt.chipWalk',
        defaultMessage: 'Walk around',
        description: 'Example prompt chip: make the sprite walk'
    },
    chipSpin: {
        id: 'vibe.prompt.chipSpin',
        defaultMessage: 'Keep spinning',
        description: 'Example prompt chip: make the sprite spin forever'
    },
    chipHello: {
        id: 'vibe.prompt.chipHello',
        defaultMessage: 'Say hello',
        description: 'Example prompt chip: make the sprite say hello'
    },
    tryAgain: {
        id: 'vibe.prompt.tryAgain',
        defaultMessage: 'Try again',
        description: 'Button to retry the last request after an error'
    },
    welcomeTitle: {
        id: 'vibe.prompt.welcomeTitle',
        defaultMessage: 'What should we make?',
        description: 'Title of the empty-chat welcome state'
    },
    welcomeSubtitle: {
        id: 'vibe.prompt.welcomeSubtitle',
        defaultMessage: 'Try saying…',
        description: 'Subtitle prompting the child to pick an example prompt'
    },
    title: {
        id: 'vibe.prompt.title',
        defaultMessage: 'Vibe Block Coding',
        description: 'Title shown in the floating AI card header'
    },
    collapse: {
        id: 'vibe.prompt.collapse',
        defaultMessage: 'Collapse',
        description: 'Tooltip for the button that collapses the card'
    },
    expand: {
        id: 'vibe.prompt.expand',
        defaultMessage: 'Expand',
        description: 'Tooltip for the button that expands the card'
    },
    back: {
        id: 'vibe.prompt.back',
        defaultMessage: 'Back',
        description: 'Button to cancel changing the API key and keep the current one'
    }
});

// A chip is its own component with a bound handler so the mapped list needs no
// inline arrow in JSX (project lint forbids react/jsx-no-bind). It reports its
// filled sentence back up via onClick(label) — fill only, never auto-run.
class ChipButton extends React.Component {
    constructor (props) {
        super(props);
        this.handleClick = this.handleClick.bind(this);
    }
    handleClick () {
        this.props.onClick(this.props.label);
    }
    render () {
        const {emoji, label} = this.props;
        return (
            <button
                className={this.props.className}
                type="button"
                disabled={this.props.disabled}
                onClick={this.handleClick}
            >
                {emoji ? `${emoji} ${label}` : label}
            </button>
        );
    }
}

ChipButton.propTypes = {
    className: PropTypes.string,
    disabled: PropTypes.bool,
    emoji: PropTypes.string,
    label: PropTypes.string.isRequired,
    onClick: PropTypes.func.isRequired
};

// The three example prompts, each with a display-only emoji. Emoji is a
// render-time prefix (ChipButton) — never part of the translated label, so
// onChipClick receives the plain sentence.
const EXAMPLE_CHIPS = [
    {msg: messages.chipWalk, emoji: '🚶'},
    {msg: messages.chipSpin, emoji: '🌀'},
    {msg: messages.chipHello, emoji: '👋'}
];

// Shared by the welcome and the sheet. `disabled` greys chips while a request is
// in flight (only relevant in the sheet — the welcome never coexists with busy).
const renderExampleChips = (intl, onChipClick, disabled) => (
    EXAMPLE_CHIPS.map(({msg, emoji}) => (
        <ChipButton
            key={msg.id}
            className={classNames(styles.exampleChip, 'vibe-example-chip')}
            disabled={disabled}
            emoji={emoji}
            label={intl.formatMessage(msg)}
            onClick={onChipClick}
        />
    ))
);

// Empty-chat onboarding surface: fills the conversation area with a friendly
// prompt + the example chips. Pure render — shown when turns.length === 0.
const WelcomeExamples = ({intl, onChipClick}) => (
    <div className={styles.welcome}>
        <div className={styles.welcomeTitle}>
            {intl.formatMessage(messages.welcomeTitle)} {'✨'}
        </div>
        <div className={styles.welcomeSubtitle}>
            {intl.formatMessage(messages.welcomeSubtitle)}
        </div>
        {renderExampleChips(intl, onChipClick, false)}
    </div>
);

WelcomeExamples.propTypes = {
    intl: intlShape.isRequired,
    onChipClick: PropTypes.func.isRequired
};

// Every edge + corner is a resize grip. Corners come last so they paint over the
// edge strips they overlap. Class names are camelCase to survive css-loader's
// locals conversion (bracket access on underscore names is not portable).
const RESIZE_HANDLES = [
    {dir: 'n', cls: 'rhN'}, {dir: 's', cls: 'rhS'}, {dir: 'e', cls: 'rhE'}, {dir: 'w', cls: 'rhW'},
    {dir: 'ne', cls: 'rhNe'}, {dir: 'nw', cls: 'rhNw'}, {dir: 'se', cls: 'rhSe'}, {dir: 'sw', cls: 'rhSw'}
];

// Default height (px) for the chat view when the child hasn't resized the card, so
// the chat log fills the space and the composer (input + chips) sits at the bottom
// like a normal chat rather than floating near the top. A user resize overrides it.
const DEFAULT_CHAT_H = 320;

const VibePromptComponent = props => {
    const {
        intl, hasKey, busy, error,
        keyDraft, instructionDraft,
        onKeyDraftChange, onInstructionDraftChange,
        onSubmitKey, onSubmitInstruction, onEditKey,
        onChipClick, onRetry,
        collapsed, position, onToggleCollapse, onDragStop,
        turns, vm, onClearHistory, onApply, onIgnore, onRebuild, onMakeIt,
        canCancelKey, onCancelKey, size, onResizeStart,
        contextTurns, onContextTurnsChange
    } = props;

    // Chat mode (key set, expanded): give the card a comfortable default height so the
    // log fills it and the composer pins to the bottom. A stored/resized height wins.
    const chatMode = hasKey && !collapsed;
    const cardH = size.h || (chatMode ? DEFAULT_CHAT_H : null);
    const sized = Boolean(cardH) && !collapsed;
    const cardStyle = {width: size.w};
    if (sized) cardStyle.height = cardH;

    const keyEntry = (
        <div className={styles.body}>
            {canCancelKey && (
                <button
                    className={styles.backBtn}
                    type="button"
                    onClick={onCancelKey}
                >
                    {'‹ '}{intl.formatMessage(messages.back)}
                </button>
            )}
            <form
                className={styles.row}
                onSubmit={onSubmitKey}
            >
                <span className={styles.icon}>{'🔑'}</span>
                <input
                    aria-label={intl.formatMessage(messages.keyPlaceholder)}
                    autoComplete="off"
                    spellCheck={false}
                    className={styles.input}
                    type="text"
                    inputMode="text"
                    placeholder={intl.formatMessage(messages.keyPlaceholder)}
                    value={keyDraft}
                    onChange={onKeyDraftChange}
                />
                <button
                    className={styles.button}
                    type="submit"
                >
                    {intl.formatMessage(messages.saveKey)}
                </button>
            </form>
            <div className={styles.notice}>
                {intl.formatMessage(messages.keyNotice)}
            </div>
            {error && (
                <div
                    className={classNames(styles.status, styles.error)}
                    role="alert"
                >
                    {intl.formatMessage(messages.saveKeyError)}
                </div>
            )}
            <div className={styles.memoryRow}>
                <label
                    className={styles.memoryLabel}
                    htmlFor="vibe-memory-slider-input"
                >
                    {intl.formatMessage(memoryMessages.memoryLabel)}
                </label>
                <MemorySlider
                    id="vibe-memory-slider-input"
                    value={contextTurns}
                    ariaLabel={intl.formatMessage(memoryMessages.memoryLabel)}
                    className={styles.memorySlider}
                    onChange={onContextTurnsChange}
                />
                <span className={styles.memoryValue}>{contextTurns}</span>
                <div className={styles.notice}>
                    {intl.formatMessage(memoryMessages.memoryHint)}
                </div>
            </div>
        </div>
    );

    const instructionEntry = (
        <div className={styles.body}>
            <div className={styles.convArea}>
                {turns.length === 0 ? (
                    <WelcomeExamples
                        intl={intl}
                        onChipClick={onChipClick}
                    />
                ) : (
                    <HistoryList
                        turns={turns}
                        vm={vm}
                        onClearHistory={onClearHistory}
                        onApply={onApply}
                        onIgnore={onIgnore}
                        onRebuild={onRebuild}
                        onMakeIt={onMakeIt}
                    />
                )}
            </div>
            <form
                className={classNames(styles.row, styles.composerAnchor)}
                onSubmit={onSubmitInstruction}
            >
                <span className={styles.icon}>{'💬'}</span>
                <input
                    aria-label={intl.formatMessage(messages.instructionPlaceholder)}
                    className={styles.input}
                    type="text"
                    inputMode="text"
                    maxLength={500}
                    disabled={busy}
                    placeholder={intl.formatMessage(messages.instructionPlaceholder)}
                    value={instructionDraft}
                    onChange={onInstructionDraftChange}
                />
                <button
                    className={styles.button}
                    disabled={busy}
                    type="submit"
                >
                    {intl.formatMessage(messages.send)}
                </button>
            </form>
            {busy && (
                <div className={styles.status}>
                    <span aria-live="polite">
                        {intl.formatMessage(messages.working)}
                    </span>
                    {/* Decorative dots kept OUTSIDE the live region so their
                        markup can never interact with live-region recomputation. */}
                    <span
                        className={styles.dots}
                        aria-hidden="true"
                    >
                        <span />
                        <span />
                        <span />
                    </span>
                </div>
            )}
            {error && !busy && (
                <div
                    className={classNames(styles.status, styles.error)}
                    role="alert"
                >
                    <span>{intl.formatMessage(messages.error)}</span>
                    <button
                        className={styles.retry}
                        type="button"
                        onClick={onRetry}
                    >
                        {intl.formatMessage(messages.tryAgain)}
                    </button>
                </div>
            )}
        </div>
    );

    const body = hasKey ? instructionEntry : keyEntry;
    const collapseLabel = intl.formatMessage(collapsed ? messages.expand : messages.collapse);

    return (
        // Full-viewport, click-through layer = the react-draggable bounds parent.
        <div className={styles.overlay}>
            <Draggable
                bounds="parent"
                handle=".vibe-drag-handle"
                cancel=".vibe-no-drag"
                position={position}
                onStop={onDragStop}
            >
                <div
                    className={classNames(styles.card, sized ? styles.sized : null)}
                    style={cardStyle}
                >
                    <div className={classNames(styles.header, 'vibe-drag-handle')}>
                        <span className={styles.headerTitle}>
                            {intl.formatMessage(messages.title)} {'✨'}
                        </span>
                        <span className={styles.headerActions}>
                            {collapsed && (busy || error) && (
                                // Collapsed hides the body; surface a hint so a
                                // child knows a request is running/failed.
                                <span
                                    className={styles.headerDot}
                                    aria-hidden="true"
                                >
                                    {busy ? '⏳' : '⚠️'}
                                </span>
                            )}
                            {hasKey && (
                                <button
                                    aria-label={intl.formatMessage(messages.resetKey)}
                                    className={classNames(styles.gear, 'vibe-no-drag')}
                                    type="button"
                                    disabled={busy}
                                    title={intl.formatMessage(messages.resetKey)}
                                    onClick={onEditKey}
                                >
                                    {'⚙️'}
                                </button>
                            )}
                            <button
                                aria-label={collapseLabel}
                                className={classNames(styles.collapseBtn, 'vibe-no-drag')}
                                type="button"
                                title={collapseLabel}
                                onClick={onToggleCollapse}
                            >
                                {collapsed ? '▸' : '▾'}
                            </button>
                        </span>
                    </div>
                    {collapsed ? null : body}
                    {collapsed ? null : RESIZE_HANDLES.map(handle => (
                        <div
                            key={handle.dir}
                            className={classNames(styles.resizeHandle, styles[handle.cls], 'vibe-no-drag')}
                            data-dir={handle.dir}
                            onMouseDown={onResizeStart}
                            onTouchStart={onResizeStart}
                        />
                    ))}
                </div>
            </Draggable>
        </div>
    );
};

VibePromptComponent.defaultProps = {
    busy: false,
    canCancelKey: false,
    collapsed: false,
    contextTurns: 3,
    error: false,
    hasKey: false,
    onContextTurnsChange: noop,
    turns: [],
    instructionDraft: '',
    keyDraft: '',
    position: {x: 0, y: 0},
    size: {w: 300, h: null}
};

VibePromptComponent.propTypes = {
    busy: PropTypes.bool,
    canCancelKey: PropTypes.bool,
    collapsed: PropTypes.bool,
    contextTurns: PropTypes.number,
    error: PropTypes.bool,
    hasKey: PropTypes.bool,
    instructionDraft: PropTypes.string,
    intl: intlShape.isRequired,
    keyDraft: PropTypes.string,
    onApply: PropTypes.func,
    onCancelKey: PropTypes.func,
    onChipClick: PropTypes.func.isRequired,
    onClearHistory: PropTypes.func,
    onContextTurnsChange: PropTypes.func,
    onDragStop: PropTypes.func.isRequired,
    onEditKey: PropTypes.func.isRequired,
    onIgnore: PropTypes.func,
    onInstructionDraftChange: PropTypes.func.isRequired,
    onKeyDraftChange: PropTypes.func.isRequired,
    onMakeIt: PropTypes.func,
    onRebuild: PropTypes.func,
    onResizeStart: PropTypes.func,
    onRetry: PropTypes.func.isRequired,
    onSubmitInstruction: PropTypes.func.isRequired,
    onSubmitKey: PropTypes.func.isRequired,
    onToggleCollapse: PropTypes.func.isRequired,
    position: PropTypes.shape({x: PropTypes.number, y: PropTypes.number}),
    size: PropTypes.shape({w: PropTypes.number, h: PropTypes.number}),
    turns: PropTypes.array,
    vm: PropTypes.object
};

export default injectIntl(VibePromptComponent);
