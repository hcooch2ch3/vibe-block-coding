import PropTypes from 'prop-types';
import React from 'react';
import {defineMessages, injectIntl, intlShape} from 'react-intl';
import classNames from 'classnames';

import HistoryRow from './history-row.jsx';
import styles from './vibe-prompt.css';

const LIVE_PREVIEW_COUNT = 3;

const messages = defineMessages({
    historyClear: {
        id: 'vibe.prompt.historyClear',
        defaultMessage: 'Clear history',
        description: 'Button to clear the chat history list'
    },
    historyNote: {
        id: 'vibe.prompt.historyNote',
        defaultMessage: 'This browser only — not saved in the project.',
        description: 'Clarifies that the history is per-browser, not per-project'
    }
});

// The scrollable history list. Live block previews only for the latest
// LIVE_PREVIEW_COUNT entries; older entries show their labels as text.
class HistoryList extends React.Component {
    constructor (props) {
        super(props);
        this.renderRow = this.renderRow.bind(this);
    }
    renderRow (entry, i) {
        const {history, vm} = this.props;
        const live = i >= history.length - LIVE_PREVIEW_COUNT;
        return (
            <HistoryRow
                key={entry.id}
                entry={entry}
                live={live}
                vm={vm}
            />
        );
    }
    render () {
        const {intl, history, onClearHistory} = this.props;
        if (!history.length) return null;
        return (
            <div className={styles.history}>
                <div className={styles.historyHeader}>
                    <span className={styles.historyNote}>
                        {intl.formatMessage(messages.historyNote)}
                    </span>
                    <button
                        aria-label={intl.formatMessage(messages.historyClear)}
                        className={classNames(styles.clearBtn, 'vibe-no-drag')}
                        type="button"
                        title={intl.formatMessage(messages.historyClear)}
                        onClick={onClearHistory}
                    >
                        {'🗑'}
                    </button>
                </div>
                <div className={styles.historyScroll}>
                    {history.map(this.renderRow)}
                </div>
            </div>
        );
    }
}

HistoryList.propTypes = {
    history: PropTypes.array.isRequired,
    intl: intlShape.isRequired,
    onClearHistory: PropTypes.func.isRequired,
    vm: PropTypes.object
};

export default injectIntl(HistoryList);
