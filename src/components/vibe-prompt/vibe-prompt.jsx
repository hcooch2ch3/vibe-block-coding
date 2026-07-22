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
    }
});

const VibePromptComponent = props => {
    const {
        intl, hasKey, busy, error,
        keyDraft, instructionDraft,
        onKeyDraftChange, onInstructionDraftChange,
        onSubmitKey, onSubmitInstruction, onResetKey
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
    onInstructionDraftChange: PropTypes.func.isRequired,
    onKeyDraftChange: PropTypes.func.isRequired,
    onResetKey: PropTypes.func.isRequired,
    onSubmitInstruction: PropTypes.func.isRequired,
    onSubmitKey: PropTypes.func.isRequired
};

export default injectIntl(VibePromptComponent);
