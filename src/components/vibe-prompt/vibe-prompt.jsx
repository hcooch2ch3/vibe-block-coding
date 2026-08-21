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

// Public source repository. Surfaced in the settings panel to satisfy AGPL-3.0
// section 13 (offer the Corresponding Source to remote/network users).
const REPO_URL = 'https://github.com/hcooch2ch3/vibe-block-coding';

const messages = defineMessages({
    sourceLink: {
        id: 'vibe.prompt.sourceLink',
        defaultMessage: 'Source code (AGPL-3.0)',
        description: 'Link to the open-source repository, shown in the settings panel'
    },
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
    toggleExamples: {
        id: 'vibe.prompt.toggleExamples',
        defaultMessage: 'Show examples',
        description: 'Aria label/tooltip for the header button that shows example prompts'
    },
    tryAgain: {
        id: 'vibe.prompt.tryAgain',
        defaultMessage: 'Try again',
        description: 'Button to retry the last request after an error'
    },
    sheetCaption: {
        id: 'vibe.prompt.sheetCaption',
        defaultMessage: 'Try saying…',
        description: 'Caption at the top of the examples bottom sheet'
    },
    dismissExamples: {
        id: 'vibe.prompt.dismissExamples',
        defaultMessage: 'Dismiss examples',
        description: 'Aria label for the scrim behind the bottom sheet (tap to dismiss)'
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
    },
    connMethod: {
        id: 'vibe.prompt.connMethod',
        defaultMessage: 'How to connect',
        description: 'Label above the connection-mode toggle (free / own key / custom server)'
    },
    connFree: {
        id: 'vibe.prompt.connFree',
        defaultMessage: 'Free',
        description: 'Connection mode: use the hosted free demo (no key needed)'
    },
    connKey: {
        id: 'vibe.prompt.connKey',
        defaultMessage: 'My key',
        description: 'Connection mode: use your own Anthropic API key'
    },
    connServer: {
        id: 'vibe.prompt.connServer',
        defaultMessage: 'Custom server',
        description: 'Connection mode: point at your own server / gateway URL'
    },
    freeIntro: {
        id: 'vibe.prompt.freeIntro',
        defaultMessage: 'No key needed, just start making things!',
        description: 'Explanation shown when the free connection mode is selected'
    },
    startFree: {
        id: 'vibe.prompt.startFree',
        defaultMessage: 'Start',
        description: 'Button to begin using the free demo'
    },
    serverUrlPlaceholder: {
        id: 'vibe.prompt.serverUrlPlaceholder',
        defaultMessage: 'Server URL (https://…)',
        description: 'Placeholder for the custom server URL input'
    },
    serverTokenPlaceholder: {
        id: 'vibe.prompt.serverTokenPlaceholder',
        defaultMessage: 'Token (optional)',
        description: 'Placeholder for the optional custom-server token input'
    },
    serverNotice: {
        id: 'vibe.prompt.serverNotice',
        defaultMessage: 'Your token is sent to this address and stored in this browser.',
        description: 'Warning shown under the custom-server inputs'
    },
    saveServer: {
        id: 'vibe.prompt.saveServer',
        defaultMessage: 'Save server',
        description: 'Button to save the custom-server URL and token'
    },
    freeLimited: {
        id: 'vibe.prompt.freeLimited',
        defaultMessage: 'The free demo is busy right now. Add your own key to keep going.',
        description: 'Shown when the free proxy hits a rate/daily limit'
    },
    useOwnKey: {
        id: 'vibe.prompt.useOwnKey',
        defaultMessage: 'Use my key',
        description: 'Button that opens settings in own-key mode after a free-demo limit'
    }
});

// One segment of the connection-mode toggle. A bound handler reports its value
// up (no inline arrow, project lint forbids react/jsx-no-bind). Uses inline
// styles so it needs no new CSS-module classes.
const modeBtnStyle = on => ({
    flex: 1,
    padding: '6px 4px',
    fontSize: '0.78rem',
    border: '1px solid #4C97FF',
    cursor: 'pointer',
    background: on ? '#4C97FF' : '#fff',
    color: on ? '#fff' : '#4C97FF'
});
const TOGGLE_ROW_STYLE = {display: 'flex', gap: '4px', margin: '4px 0 8px'};
class ModeButton extends React.Component {
    constructor (props) {
        super(props);
        this.handleClick = this.handleClick.bind(this);
    }
    handleClick () {
        this.props.onClick(this.props.value);
    }
    render () {
        const on = this.props.value === this.props.current;
        return (
            <button
                type="button"
                aria-pressed={on}
                style={modeBtnStyle(on)}
                onClick={this.handleClick}
            >
                {this.props.label}
            </button>
        );
    }
}
ModeButton.propTypes = {
    current: PropTypes.string,
    label: PropTypes.string,
    onClick: PropTypes.func,
    value: PropTypes.string
};

// A chip is its own component with a bound handler so the mapped list needs no
// inline arrow in JSX (project lint forbids react/jsx-no-bind). It reports its
// sentence back up via onClick(label); the container sends it immediately (one-tap).
// eslint-disable-next-line react/no-multi-comp
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
// render-time prefix (ChipButton), never part of the translated label, so
// onChipClick receives the plain sentence.
const EXAMPLE_CHIPS = [
    {msg: messages.chipWalk, emoji: '🚶'},
    {msg: messages.chipSpin, emoji: '🌀'},
    {msg: messages.chipHello, emoji: '👋'}
];

// Shared by the welcome and the sheet. `disabled` greys chips while a request is
// in flight (only relevant in the sheet, the welcome never coexists with busy).
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
// prompt + the example chips. Pure render, shown when turns.length === 0.
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

// On-demand examples panel for the history view (B2): a MODAL BOTTOM SHEET that
// covers the composer. Scrim tap / Escape / drag-down-past-72px / picking an example
// all close the sheet. Focus enters the sheet on open and returns to the 💡 opener on
// close. Tab is trapped inside so focus cannot reach the covered composer while the
// sheet is open. Manual bind (no bindAll) like ChipButton.
// eslint-config-scratch's react/no-multi-comp allows stateless components but not a
// second CLASS in one file; ChipButton is already a class, so disable it just here.
// eslint-disable-next-line react/no-multi-comp
class ExampleSheet extends React.Component {
    constructor (props) {
        super(props);
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.setSheetRef = this.setSheetRef.bind(this);
        this.handleDragStart = this.handleDragStart.bind(this);
        this.handleDragMove = this.handleDragMove.bind(this);
        this.handleDragEnd = this.handleDragEnd.bind(this);
        this.sheetRef = null;
        this.prevFocus = null;
        this.dragStartY = null;
        this.state = {dragY: 0, dragging: false};
    }
    componentDidMount () {
        this.prevFocus = document.activeElement;
        // Focus the first enabled control in the sheet (fall back to the sheet
        // container) so the modal Tab-trap has a stable first edge and shift+Tab can't
        // slip back to the covered conversation.
        // preventScroll: the sheet starts translated off-screen (slide-up animation), so
        // focusing its content must NOT scroll the overflow:hidden card to reveal it.
        // That scroll jerked the header up and back down during the open animation.
        const focusables = this.sheetRef && this.sheetRef.querySelectorAll('button:not([disabled])');
        if (focusables && focusables.length) {
            focusables[0].focus({preventScroll: true});
        } else if (this.sheetRef) {
            this.sheetRef.focus({preventScroll: true});
        }
        document.addEventListener('keydown', this.handleKeyDown);
    }
    componentWillUnmount () {
        document.removeEventListener('keydown', this.handleKeyDown);
        this.removeDragListeners();
        // Restore focus to the opener (💡). Guard: on clear-history the opener unmounts
        // in the same commit, so prevFocus may be detached, only refocus if still live.
        if (this.prevFocus && document.contains(this.prevFocus) && this.prevFocus.focus) {
            this.prevFocus.focus({preventScroll: true});
        }
    }
    removeDragListeners () {
        window.removeEventListener('mousemove', this.handleDragMove);
        window.removeEventListener('mouseup', this.handleDragEnd);
        window.removeEventListener('touchmove', this.handleDragMove);
        window.removeEventListener('touchend', this.handleDragEnd);
        window.removeEventListener('touchcancel', this.handleDragEnd);
    }
    handleKeyDown (e) {
        if (e.key === 'Escape') {
            // stopPropagation so an ancestor Escape handler (e.g. fullscreen exit) does
            // not also fire on the same keypress.
            e.stopPropagation();
            this.props.onClose();
            return;
        }
        // Modal bottom sheet: trap Tab inside so focus can't reach the covered composer.
        if (e.key === 'Tab' && this.sheetRef) {
            const f = this.sheetRef.querySelectorAll('button:not([disabled])');
            if (!f.length) return;
            const first = f[0];
            const last = f[f.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus({preventScroll: true});
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus({preventScroll: true});
            }
        }
    }
    handleDragStart (e) {
        // Grab the grabber (mouse or touch) and follow the pointer downward.
        // preventDefault suppresses the browser's emulated mouse events (mousedown→
        // mouseup) after a touchstart so they don't re-enter here via onMouseDown and
        // double-register the window listeners, the same guard the resize grips use.
        // NOTE: relies on React 16 attaching touch listeners NON-passive; on a bump to
        // React 17+ (passive-by-default) this must become a ref-based native touchstart.
        if (e.cancelable) e.preventDefault();
        const p = e.touches ? e.touches[0] : e;
        if (!p) return;
        this.dragStartY = p.clientY;
        this.setState({dragging: true});
        if (e.touches) {
            window.addEventListener('touchmove', this.handleDragMove, {passive: false});
            window.addEventListener('touchend', this.handleDragEnd);
            window.addEventListener('touchcancel', this.handleDragEnd);
        } else {
            window.addEventListener('mousemove', this.handleDragMove);
            window.addEventListener('mouseup', this.handleDragEnd);
        }
    }
    handleDragMove (e) {
        if (this.dragStartY === null) return;
        const p = e.touches ? e.touches[0] : e;
        if (!p) return;
        if (e.touches && e.cancelable) e.preventDefault(); // block page scroll while dragging
        const dy = Math.max(0, p.clientY - this.dragStartY); // downward only
        this.setState({dragY: dy});
    }
    handleDragEnd () {
        this.removeDragListeners();
        const shouldClose = this.state.dragY > 72; // drag past ~72px closes
        this.dragStartY = null;
        if (shouldClose) {
            this.props.onClose();
        } else {
            this.setState({dragY: 0, dragging: false}); // snap back
        }
    }
    setSheetRef (el) {
        this.sheetRef = el;
    }
    render () {
        const {intl, onClose, onChipClick, busy} = this.props;
        const {dragY, dragging} = this.state;
        const sheetStyle = dragY ? {transform: `translateY(${dragY}px)`} : null;
        return (
            <React.Fragment>
                <button
                    aria-label={intl.formatMessage(messages.dismissExamples)}
                    className={styles.sheetScrim}
                    type="button"
                    tabIndex={-1}
                    onClick={onClose}
                />
                <div
                    className={classNames(styles.sheet, dragging ? null : styles.sheetSnap, 'vibe-example-sheet')}
                    role="dialog"
                    aria-modal="true"
                    aria-label={intl.formatMessage(messages.sheetCaption)}
                    tabIndex={-1}
                    ref={this.setSheetRef}
                    style={sheetStyle}
                >
                    <div
                        className={classNames(styles.grabber, 'vibe-sheet-grabber')}
                        onMouseDown={this.handleDragStart}
                        onTouchStart={this.handleDragStart}
                    >
                        <span className={styles.grabberBar} />
                    </div>
                    <div className={styles.sheetCap}>
                        {intl.formatMessage(messages.sheetCaption)} {'✨'}
                    </div>
                    {renderExampleChips(intl, onChipClick, busy)}
                </div>
            </React.Fragment>
        );
    }
}

ExampleSheet.propTypes = {
    busy: PropTypes.bool,
    intl: intlShape.isRequired,
    onChipClick: PropTypes.func.isRequired,
    onClose: PropTypes.func.isRequired
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
        onToggleExamples, examplesOpen,
        collapsed, position, onToggleCollapse, onDragStop,
        turns, vm, onClearHistory, onApply, onIgnore, onRebuild, onMakeIt,
        canCancelKey, onCancelKey, size, onResizeStart,
        contextTurns, onContextTurnsChange,
        mode, modeDraft, serverUrlDraft, serverTokenDraft, freeLimited,
        onModeChange, onServerUrlDraftChange, onServerTokenDraftChange,
        onSubmitServer, onStartFree, onUseOwnKey
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
            <div className={styles.notice}>
                {intl.formatMessage(messages.connMethod)}
            </div>
            <div style={TOGGLE_ROW_STYLE}>
                <ModeButton
                    value="free"
                    current={modeDraft}
                    label={intl.formatMessage(messages.connFree)}
                    onClick={onModeChange}
                />
                <ModeButton
                    value="key"
                    current={modeDraft}
                    label={intl.formatMessage(messages.connKey)}
                    onClick={onModeChange}
                />
                <ModeButton
                    value="server"
                    current={modeDraft}
                    label={intl.formatMessage(messages.connServer)}
                    onClick={onModeChange}
                />
            </div>
            {modeDraft === 'free' && (
                <div>
                    <div className={styles.notice}>
                        {intl.formatMessage(messages.freeIntro)}
                    </div>
                    <button
                        className={classNames(styles.button, styles.settingsBtn)}
                        type="button"
                        onClick={onStartFree}
                    >
                        {intl.formatMessage(messages.startFree)}
                    </button>
                </div>
            )}
            {modeDraft === 'key' && (
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
            )}
            {modeDraft === 'key' && (
                <div className={styles.notice}>
                    {intl.formatMessage(messages.keyNotice)}
                </div>
            )}
            {modeDraft === 'server' && (
                <form onSubmit={onSubmitServer}>
                    <input
                        aria-label={intl.formatMessage(messages.serverUrlPlaceholder)}
                        autoComplete="off"
                        spellCheck={false}
                        className={classNames(styles.input, styles.stackedInput)}
                        type="text"
                        inputMode="url"
                        placeholder={intl.formatMessage(messages.serverUrlPlaceholder)}
                        value={serverUrlDraft}
                        onChange={onServerUrlDraftChange}
                    />
                    <input
                        aria-label={intl.formatMessage(messages.serverTokenPlaceholder)}
                        autoComplete="off"
                        spellCheck={false}
                        className={classNames(styles.input, styles.stackedInput)}
                        type="text"
                        inputMode="text"
                        placeholder={intl.formatMessage(messages.serverTokenPlaceholder)}
                        value={serverTokenDraft}
                        onChange={onServerTokenDraftChange}
                    />
                    <button
                        className={classNames(styles.button, styles.settingsBtn)}
                        type="submit"
                    >
                        {intl.formatMessage(messages.saveServer)}
                    </button>
                </form>
            )}
            {modeDraft === 'server' && (
                <div className={styles.notice}>
                    {intl.formatMessage(messages.serverNotice)}
                </div>
            )}
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
            <a
                className={classNames(styles.sourceLink, 'vibe-source-link', 'vibe-no-drag')}
                href={REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
            >
                {intl.formatMessage(messages.sourceLink)}
            </a>
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
            {examplesOpen && turns.length > 0 && (
                <ExampleSheet
                    intl={intl}
                    busy={busy}
                    onClose={onToggleExamples}
                    onChipClick={onChipClick}
                />
            )}
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
            {freeLimited && !busy && (
                <div
                    className={classNames(styles.status, styles.error)}
                    role="alert"
                >
                    <span>{intl.formatMessage(messages.freeLimited)}</span>
                    <button
                        className={styles.retry}
                        type="button"
                        onClick={onUseOwnKey}
                    >
                        {intl.formatMessage(messages.useOwnKey)}
                    </button>
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
                    {/* Free mode has no key of its own, if the proxy is down or
                        misconfigured, retrying just fails again. Offer an escape to
                        BYOK so the user isn't stuck at a dead end. */}
                    {mode === 'free' && (
                        <button
                            className={styles.retry}
                            type="button"
                            onClick={onUseOwnKey}
                        >
                            {intl.formatMessage(messages.useOwnKey)}
                        </button>
                    )}
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
                            {hasKey && !collapsed && turns.length > 0 && (
                                <button
                                    aria-label={intl.formatMessage(messages.toggleExamples)}
                                    className={classNames(styles.bulb, 'vibe-no-drag', 'vibe-examples-btn')}
                                    type="button"
                                    title={intl.formatMessage(messages.toggleExamples)}
                                    onClick={onToggleExamples}
                                >
                                    {'💡'}
                                </button>
                            )}
                            {hasKey && !collapsed && (
                                <button
                                    aria-label={intl.formatMessage(messages.resetKey)}
                                    className={classNames(styles.gear, 'vibe-no-drag', 'vibe-gear-btn')}
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
    freeLimited: false,
    hasKey: false,
    mode: 'free',
    modeDraft: 'free',
    onContextTurnsChange: noop,
    turns: [],
    instructionDraft: '',
    keyDraft: '',
    serverUrlDraft: '',
    serverTokenDraft: '',
    position: {x: 0, y: 0},
    size: {w: 300, h: null}
};

VibePromptComponent.propTypes = {
    busy: PropTypes.bool,
    canCancelKey: PropTypes.bool,
    collapsed: PropTypes.bool,
    contextTurns: PropTypes.number,
    error: PropTypes.bool,
    examplesOpen: PropTypes.bool,
    freeLimited: PropTypes.bool,
    hasKey: PropTypes.bool,
    instructionDraft: PropTypes.string,
    intl: intlShape.isRequired,
    keyDraft: PropTypes.string,
    mode: PropTypes.oneOf(['free', 'key', 'server']),
    modeDraft: PropTypes.oneOf(['free', 'key', 'server']),
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
    onModeChange: PropTypes.func,
    onRebuild: PropTypes.func,
    onResizeStart: PropTypes.func,
    onRetry: PropTypes.func.isRequired,
    onServerTokenDraftChange: PropTypes.func,
    onServerUrlDraftChange: PropTypes.func,
    onStartFree: PropTypes.func,
    onSubmitInstruction: PropTypes.func.isRequired,
    onSubmitKey: PropTypes.func.isRequired,
    onSubmitServer: PropTypes.func,
    onToggleCollapse: PropTypes.func.isRequired,
    onToggleExamples: PropTypes.func,
    onUseOwnKey: PropTypes.func,
    position: PropTypes.shape({x: PropTypes.number, y: PropTypes.number}),
    serverTokenDraft: PropTypes.string,
    serverUrlDraft: PropTypes.string,
    size: PropTypes.shape({w: PropTypes.number, h: PropTypes.number}),
    turns: PropTypes.array,
    vm: PropTypes.object
};

export default injectIntl(VibePromptComponent);
