import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import {defineMessages, injectIntl, intlShape} from 'react-intl';
import classNames from 'classnames';
import ProposalCard from './proposal-card.jsx';
import styles from './vibe-prompt.css';

const messages = defineMessages({
    makeIt: {id: 'vibe.prompt.makeIt', defaultMessage: '🧩 Make it', description: 'Turn an answer into a build'}
});

// Turn a proposal's ops into the {script, variant} list the card renders. add →
// a new stack ('added'); replace → an existing stack changed ('updated'); remove
// and keep show nothing (remove is surfaced separately as a count). Missing preview
// (terminal turns strip it) → [].
const buildPreviews = function (preview) {
    if (!preview || !Array.isArray(preview.ops)) return [];
    return preview.ops
        .filter(op => op.type === 'add' || op.type === 'replace')
        .map(op => ({script: op.script, variant: op.type === 'add' ? 'added' : 'updated'}));
};
const countRemoves = function (preview) {
    return (preview && Array.isArray(preview.ops)) ? preview.ops.filter(op => op.type === 'remove').length : 0;
};

// Renders one chat turn by shape. Class (not functional) so the Make-it/Apply/Ignore/
// Rebuild handlers are bound methods closing over `turn` — no inline JSX arrows (jsx-no-bind).
class HistoryRow extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, ['handleApply', 'handleIgnore', 'handleRebuild', 'handleMakeIt']);
    }
    handleApply () {
        this.props.onApply(this.props.turn);
    }
    handleIgnore () {
        this.props.onIgnore(this.props.turn);
    }
    handleRebuild () {
        this.props.onRebuild(this.props.turn);
    }
    handleMakeIt () {
        this.props.onMakeIt(this.props.turn);
    }
    render () {
        const {turn, intl, vm} = this.props;
        if (turn.role === 'user') {
            return (
                <div className={classNames('vibe-bubble', 'vibe-bubble--user', styles.userBubble)}>
                    {turn.text}
                </div>
            );
        }
        if (turn.kind === 'answer') {
            return (
                <div className={classNames('vibe-bubble', 'vibe-bubble--ai', styles.aiBubble)}>
                    <div className={styles.bubbleText}>{turn.text}</div>
                    <button
                        className={classNames('vibe-makeit', styles.makeIt)}
                        type="button"
                        onClick={this.handleMakeIt}
                    >
                        {intl.formatMessage(messages.makeIt)}
                    </button>
                </div>
            );
        }
        if (turn.kind !== 'proposal') return null;
        // kind === 'proposal'. The proposal carries the resolved ops (add/replace/
        // remove); the card shows a BlockPreview per add/replace and a "removes N"
        // warning for removes. Unmentioned (kept) scripts produce no op, so they
        // never re-appear as "added".
        const previews = buildPreviews(turn.preview);
        const removeCount = countRemoves(turn.preview);
        return (
            <ProposalCard
                status={turn.status}
                previews={previews}
                removeCount={removeCount}
                explanation={turn.text}
                vm={vm}
                onApply={this.handleApply}
                onIgnore={this.handleIgnore}
                onRebuild={this.handleRebuild}
            />
        );
    }
}

HistoryRow.propTypes = {
    intl: intlShape.isRequired,
    onApply: PropTypes.func,
    onIgnore: PropTypes.func,
    onMakeIt: PropTypes.func,
    onRebuild: PropTypes.func,
    turn: PropTypes.object.isRequired,
    vm: PropTypes.object
};

const noop = function () {};
HistoryRow.defaultProps = {onApply: noop, onIgnore: noop, onRebuild: noop, onMakeIt: noop};

export {HistoryRow};
export default injectIntl(HistoryRow);
