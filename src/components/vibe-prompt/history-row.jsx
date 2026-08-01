import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import {defineMessages, injectIntl, intlShape} from 'react-intl';
import classNames from 'classnames';
import ProposalCard from './proposal-card.jsx';
import {diff} from '../../lib/ai-harness/edit';
import styles from './vibe-prompt.css';

const messages = defineMessages({
    makeIt: {id: 'vibe.prompt.makeIt', defaultMessage: '🧩 Make it', description: 'Turn an answer into a build'}
});

// Turn a proposal's preview into the list of {script, variant} the card renders.
// generate → every block is newly added. edit → only the scripts the diff marks
// add (new stack, 'added') or replace (existing stack changed, 'updated'); kept
// scripts are omitted so the card shows just what this turn does. Missing preview
// (terminal turns strip it) → [].
const buildPreviews = function (preview) {
    if (!preview) return [];
    if (preview.kind === 'generate') {
        return preview.blocks.map(script => ({script, variant: 'added'}));
    }
    return diff(preview.oldScripts, preview.newScripts)
        .filter(op => op.type === 'add' || op.type === 'replace')
        .map(op => ({script: op.script, variant: op.type === 'add' ? 'added' : 'updated'}));
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
        // kind === 'proposal'. Preview only the scripts this proposal actually
        // CHANGES — not the whole post-edit program. An 'edit' turn sends the
        // current program to the model and gets the full modified program back,
        // so newScripts still contains the unchanged (kept) scripts; showing them
        // would falsely re-present already-applied blocks as "added". Run the same
        // diff apply uses and keep only add/replace, tagging each with its variant.
        const previews = buildPreviews(turn.preview);
        return (
            <ProposalCard
                status={turn.status}
                previews={previews}
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
