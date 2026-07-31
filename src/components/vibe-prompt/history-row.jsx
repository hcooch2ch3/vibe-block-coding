import PropTypes from 'prop-types';
import React from 'react';
import {defineMessages, injectIntl, intlShape} from 'react-intl';
import classNames from 'classnames';

import BlockPreview from './block-preview.jsx';
import styles from './vibe-prompt.css';

const messages = defineMessages({
    changeAdded: {
        id: 'vibe.prompt.changeAdded',
        defaultMessage: 'Added',
        description: 'Label for a script that was added'
    },
    changeRemoved: {
        id: 'vibe.prompt.changeRemoved',
        defaultMessage: 'Removed',
        description: 'Label for a script that was removed'
    },
    changeUpdated: {
        id: 'vibe.prompt.changeUpdated',
        defaultMessage: 'Updated',
        description: 'Label for a script that was updated'
    },
    historyFailed: {
        id: 'vibe.prompt.historyFailed',
        defaultMessage: 'That did not work.',
        description: 'Shown for a failed request in the history list'
    }
});

const CHANGE_LABEL = {
    added: messages.changeAdded,
    removed: messages.changeRemoved,
    updated: messages.changeUpdated
};

// One history row: the instruction + (for recent entries) real-block previews of
// the changed scripts. A class so the change list uses a bound method reference,
// not an inline arrow (project lint forbids react/jsx-no-bind).
class HistoryRow extends React.Component {
    constructor (props) {
        super(props);
        this.renderChange = this.renderChange.bind(this);
    }
    renderChange (change, i) {
        const {intl, live, vm} = this.props;
        return (
            <div
                key={i}
                className={styles.change}
            >
                <span className={styles.changeLabel}>
                    {intl.formatMessage(CHANGE_LABEL[change.kind])}
                </span>
                {live ? (
                    <BlockPreview
                        vm={vm}
                        script={change.script}
                        variant={change.kind}
                    />
                ) : null}
            </div>
        );
    }
    render () {
        const {intl, entry} = this.props;
        if (entry.status === 'failed') {
            return (
                <div className={styles.historyRow}>
                    <div className={styles.historyInstruction}>{entry.instruction}</div>
                    <div className={classNames(styles.status, styles.error)}>
                        {intl.formatMessage(messages.historyFailed)}
                    </div>
                </div>
            );
        }
        return (
            <div className={styles.historyRow}>
                <div className={styles.historyInstruction}>{entry.instruction}</div>
                {entry.changes.map(this.renderChange)}
            </div>
        );
    }
}

HistoryRow.propTypes = {
    entry: PropTypes.object.isRequired,
    intl: intlShape.isRequired,
    live: PropTypes.bool,
    vm: PropTypes.object
};

export default injectIntl(HistoryRow);
