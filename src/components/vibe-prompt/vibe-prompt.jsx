import PropTypes from 'prop-types';
import React from 'react';
import {defineMessages, injectIntl, intlShape} from 'react-intl';
import classNames from 'classnames';
import Draggable from 'react-draggable';

import HistoryList from './history-list.jsx';
import styles from './vibe-prompt.css';

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
    title: {
        id: 'vibe.prompt.title',
        defaultMessage: 'Make it with words',
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
        return (
            <button
                className={this.props.className}
                type="button"
                disabled={this.props.disabled}
                onClick={this.handleClick}
            >
                {this.props.label}
            </button>
        );
    }
}

ChipButton.propTypes = {
    className: PropTypes.string,
    disabled: PropTypes.bool,
    label: PropTypes.string.isRequired,
    onClick: PropTypes.func.isRequired
};

// Every edge + corner is a resize grip. Corners come last so they paint over the
// edge strips they overlap. Class names are camelCase to survive css-loader's
// locals conversion (bracket access on underscore names is not portable).
const RESIZE_HANDLES = [
    {dir: 'n', cls: 'rhN'}, {dir: 's', cls: 'rhS'}, {dir: 'e', cls: 'rhE'}, {dir: 'w', cls: 'rhW'},
    {dir: 'ne', cls: 'rhNe'}, {dir: 'nw', cls: 'rhNw'}, {dir: 'se', cls: 'rhSe'}, {dir: 'sw', cls: 'rhSw'}
];

const VibePromptComponent = props => {
    const {
        intl, hasKey, busy, error,
        keyDraft, instructionDraft,
        onKeyDraftChange, onInstructionDraftChange,
        onSubmitKey, onSubmitInstruction, onEditKey,
        onChipClick, onRetry,
        collapsed, position, onToggleCollapse, onDragStop,
        turns, vm, onClearHistory, onApply, onIgnore, onRebuild, onMakeIt,
        canCancelKey, onCancelKey, size, onResizeStart
    } = props;

    const sized = Boolean(size.h) && !collapsed;
    const cardStyle = {width: size.w};
    if (sized) cardStyle.height = size.h;

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
        </div>
    );

    const instructionEntry = (
        <div className={styles.body}>
            <HistoryList
                turns={turns}
                vm={vm}
                onClearHistory={onClearHistory}
                onApply={onApply}
                onIgnore={onIgnore}
                onRebuild={onRebuild}
                onMakeIt={onMakeIt}
            />
            <form
                className={styles.row}
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
            <div className={styles.chips}>
                {[messages.chipWalk, messages.chipSpin, messages.chipHello].map(chip => (
                    <ChipButton
                        key={chip.id}
                        className={styles.chip}
                        disabled={busy}
                        label={intl.formatMessage(chip)}
                        onClick={onChipClick}
                    />
                ))}
            </div>
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
    error: false,
    hasKey: false,
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
    error: PropTypes.bool,
    hasKey: PropTypes.bool,
    instructionDraft: PropTypes.string,
    intl: intlShape.isRequired,
    keyDraft: PropTypes.string,
    onApply: PropTypes.func,
    onCancelKey: PropTypes.func,
    onChipClick: PropTypes.func.isRequired,
    onClearHistory: PropTypes.func,
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
