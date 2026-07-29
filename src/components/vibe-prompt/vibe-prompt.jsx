import PropTypes from 'prop-types';
import React from 'react';
import {defineMessages, injectIntl, intlShape} from 'react-intl';
import classNames from 'classnames';

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

const VibePromptComponent = props => {
    const {
        intl, hasKey, busy, error,
        keyDraft, instructionDraft,
        onKeyDraftChange, onInstructionDraftChange,
        onSubmitKey, onSubmitInstruction, onResetKey,
        onChipClick
    } = props;

    if (!hasKey) {
        return (
            <div className={styles.vibePrompt}>
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
    }

    return (
        <div className={styles.vibePrompt}>
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
                    aria-label={intl.formatMessage(messages.resetKey)}
                    className={styles.gear}
                    type="button"
                    disabled={busy}
                    title={intl.formatMessage(messages.resetKey)}
                    onClick={onResetKey}
                >
                    {'⚙️'}
                </button>
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
                <div
                    className={styles.status}
                    aria-live="polite"
                >
                    {intl.formatMessage(messages.working)}
                </div>
            )}
            {error && !busy && (
                <div
                    className={classNames(styles.status, styles.error)}
                    role="alert"
                >
                    {intl.formatMessage(messages.error)}
                </div>
            )}
        </div>
    );
};

VibePromptComponent.defaultProps = {
    busy: false,
    error: false,
    hasKey: false,
    instructionDraft: '',
    keyDraft: ''
};

VibePromptComponent.propTypes = {
    busy: PropTypes.bool,
    error: PropTypes.bool,
    hasKey: PropTypes.bool,
    instructionDraft: PropTypes.string,
    intl: intlShape.isRequired,
    keyDraft: PropTypes.string,
    onChipClick: PropTypes.func.isRequired,
    onInstructionDraftChange: PropTypes.func.isRequired,
    onKeyDraftChange: PropTypes.func.isRequired,
    onResetKey: PropTypes.func.isRequired,
    onSubmitInstruction: PropTypes.func.isRequired,
    onSubmitKey: PropTypes.func.isRequired
};

export default injectIntl(VibePromptComponent);
