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
    },
    removes: {
        id: 'vibe.proposal.removes',
        defaultMessage: 'This will remove {count, plural, one {# block stack} other {# block stacks}}.',
        description: 'Warning shown before applying a proposal that deletes script stacks'
    }
});

// Stateless. Header (status label + the right buttons for `status`) then one
// BlockPreview per changed script. `previews` is [{script, variant}], the caller
// already dropped unchanged scripts and tagged each with added/updated. Named
// export for shallow tests; default is intl-wrapped.
const ProposalCard = function ({status, previews, removeCount, explanation, onApply, onIgnore, onRebuild, vm, intl}) {
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
                    <React.Fragment>
                        <span className={classNames('proposal-card__stale-label', styles.staleLabel)}>
                            {intl.formatMessage(messages.stale)}
                        </span>
                        <button
                            className={classNames('proposal-card__rebuild', styles.rebuild)}
                            type="button"
                            onClick={onRebuild}
                        >
                            {intl.formatMessage(messages.rebuild)}
                        </button>
                    </React.Fragment>
                )}
                {status === 'applied' && (
                    <span className={classNames('proposal-card__applied', styles.applied)}>
                        {intl.formatMessage(messages.applied)}
                    </span>
                )}
                {status === 'ignored' && (
                    <span className={classNames('proposal-card__ignored', styles.ignored)}>
                        {intl.formatMessage(messages.ignored)}
                    </span>
                )}
            </div>
            {explanation ? (
                <div className={classNames('proposal-card__explanation', styles.explanation)}>{explanation}</div>
            ) : null}
            {(status === 'pending' || status === 'stale') && removeCount > 0 && (
                <div className={classNames('proposal-card__removes', styles.removes)}>
                    {intl.formatMessage(messages.removes, {count: removeCount})}
                </div>
            )}
            {(status === 'pending' || status === 'stale') && previews.map((p, i) => (
                <BlockPreview
                    key={i}
                    script={p.script}
                    variant={p.variant}
                    vm={vm}
                />
            ))}
        </div>
    );
};

const noop = function () {};

ProposalCard.propTypes = {
    explanation: PropTypes.string,
    intl: intlShape.isRequired,
    onApply: PropTypes.func,
    onIgnore: PropTypes.func,
    onRebuild: PropTypes.func,
    previews: PropTypes.arrayOf(PropTypes.shape({
        script: PropTypes.shape({hat: PropTypes.string, body: PropTypes.array}),
        variant: PropTypes.oneOf(['added', 'updated'])
    })).isRequired,
    removeCount: PropTypes.number,
    status: PropTypes.oneOf(['pending', 'stale', 'applied', 'ignored']).isRequired,
    vm: PropTypes.object
};

ProposalCard.defaultProps = {onApply: noop, onIgnore: noop, onRebuild: noop, removeCount: 0};

export {ProposalCard};
export default injectIntl(ProposalCard);
