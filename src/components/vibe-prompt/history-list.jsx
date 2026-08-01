import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import {defineMessages, injectIntl, intlShape} from 'react-intl';
import classNames from 'classnames';

import HistoryRow from './history-row.jsx';
import styles from './vibe-prompt.css';

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

// Scrollable turn list. Each turn is rendered by HistoryRow. Uses a bound
// renderRow method so no inline arrows appear in JSX (jsx-no-bind).
class HistoryList extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, ['renderRow']);
    }
    renderRow (turn) {
        const {vm, onApply, onIgnore, onRebuild, onMakeIt} = this.props;
        return (
            <HistoryRow
                key={turn.id}
                turn={turn}
                vm={vm}
                onApply={onApply}
                onIgnore={onIgnore}
                onRebuild={onRebuild}
                onMakeIt={onMakeIt}
            />
        );
    }
    render () {
        const {intl, turns, onClearHistory} = this.props;
        if (!turns.length) return null;
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
                    {turns.map(this.renderRow)}
                </div>
            </div>
        );
    }
}

const noop = function () {};

HistoryList.propTypes = {
    intl: intlShape.isRequired,
    onApply: PropTypes.func,
    onClearHistory: PropTypes.func,
    onIgnore: PropTypes.func,
    onMakeIt: PropTypes.func,
    onRebuild: PropTypes.func,
    turns: PropTypes.array.isRequired,
    vm: PropTypes.object
};

HistoryList.defaultProps = {
    onApply: noop,
    onClearHistory: noop,
    onIgnore: noop,
    onMakeIt: noop,
    onRebuild: noop
};

export {HistoryList};
export default injectIntl(HistoryList);
