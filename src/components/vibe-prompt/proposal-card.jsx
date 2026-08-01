import PropTypes from 'prop-types';
import React from 'react';
import {defineMessages, injectIntl, intlShape} from 'react-intl';
import classNames from 'classnames';
import BlockPreview from './block-preview.jsx';
import styles from './proposal-card.css';

const messages = defineMessages({
    apply: {id: 'vibe.proposal.apply', defaultMessage: 'Apply', description: 'Apply the proposed blocks'},
    ignore: {id: 'vibe.proposal.ignore', defaultMessage: 'Ignore', description: 'Dismiss the proposal'},
    rebuild: {
        id: 'vibe.proposal.rebuild',
        defaultMessage: 'Rebuild',
        description: 'Re-run because the workspace changed'
    },
    applied: {id: 'vibe.proposal.applied', defaultMessage: '✓ Applied', description: 'Proposal was applied'},
    ignored: {id: 'vibe.proposal.ignored', defaultMessage: 'Ignored', description: 'Proposal was ignored'},
    stale: {
        id: 'vibe.proposal.stale',
        defaultMessage: 'Workspace changed',
        description: 'The workspace changed since this was proposed'
    }
});

// Stateless. Header (status label + the right buttons for `status`) then one
// BlockPreview per script. Named export for shallow tests; default is intl-wrapped.
const ProposalCard = function ({status, scripts, explanation, onApply, onIgnore, onRebuild, intl}) {
    return (
        <div className={classNames('proposal-card', styles.card)}>
            <div className={classNames('proposal-card__header', styles.header)}>
                {status === 'pending' && (
                    <React.Fragment>
                        <button
                            className={classNames('proposal-card__apply', styles.apply)}
                            type="button"
                            onClick={onApply}
                        >
                            {intl.formatMessage(messages.apply)}
                        </button>
                        <button
                            className={classNames('proposal-card__ignore', styles.ignore)}
                            type="button"
                            onClick={onIgnore}
                        >
                            {intl.formatMessage(messages.ignore)}
                        </button>
                    </React.Fragment>
                )}
                {status === 'stale' && (
                    <button
                        className={classNames('proposal-card__rebuild', styles.rebuild)}
                        type="button"
                        onClick={onRebuild}
                    >
                        {intl.formatMessage(messages.rebuild)}
                    </button>
                )}
                {status === 'applied' && (
                    <span className="proposal-card__applied">{intl.formatMessage(messages.applied)}</span>
                )}
                {status === 'ignored' && (
                    <span className="proposal-card__ignored">{intl.formatMessage(messages.ignored)}</span>
                )}
            </div>
            {explanation ? (
                <div className={classNames('proposal-card__explanation', styles.explanation)}>{explanation}</div>
            ) : null}
            {scripts.map((s, i) => (
                <BlockPreview
                    key={i}
                    script={s}
                    variant="added"
                />
            ))}
        </div>
    );
};

ProposalCard.propTypes = {
    explanation: PropTypes.string,
    intl: intlShape.isRequired,
    onApply: PropTypes.func,
    onIgnore: PropTypes.func,
    onRebuild: PropTypes.func,
    scripts: PropTypes.array.isRequired,
    status: PropTypes.oneOf(['pending', 'stale', 'applied', 'ignored']).isRequired
};

export {ProposalCard};
export default injectIntl(ProposalCard);
