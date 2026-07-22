import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import {connect} from 'react-redux';
import VM from 'scratch-vm';

import VibePromptComponent from '../components/vibe-prompt/vibe-prompt.jsx';
import {generate, edit} from '../lib/ai-harness/dev-console';
import {decompile} from '../lib/ai-harness/dsl';
import {loadKey, saveKey, clearKey} from '../lib/ai-harness/key-store';

class VibePrompt extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleKeyDraftChange',
            'handleInstructionDraftChange',
            'handleSubmitKey',
            'handleSubmitInstruction',
            'handleResetKey'
        ]);
        this.state = {
            apiKey: loadKey(),
            keyDraft: '',
            instructionDraft: '',
            busy: false,
            error: false
        };
    }
    handleKeyDraftChange (e) {
        this.setState({keyDraft: e.target.value, error: false});
    }
    handleInstructionDraftChange (e) {
        // clear a stale error as soon as the child starts revising (Task 2 review)
        this.setState({instructionDraft: e.target.value, error: false});
    }
    handleSubmitKey (e) {
        e.preventDefault();
        const key = this.state.keyDraft.trim();
        if (!key) return;
        // saveKey returns false when storage rejects the write (private mode /
        // quota). Surface it instead of silently claiming success (Task 1 review).
        if (!saveKey(key)) {
            this.setState({error: true});
            return;
        }
        this.setState({apiKey: key, keyDraft: '', error: false});
    }
    handleResetKey () {
        if (this.state.busy) return;
        clearKey();
        this.setState({apiKey: '', error: false});
    }
    handleSubmitInstruction (e) {
        e.preventDefault();
        const instruction = this.state.instructionDraft.trim();
        const vm = this.props.vm;
        if (!instruction || this.state.busy || !this.state.apiKey ||
            !vm || !vm.editingTarget) {
            return;
        }

        // Pin the sprite now so a mid-request sprite switch can't apply this
        // diff to a different target (silent block loss). Stop threads so
        // applyEdit's deleteBlock doesn't orphan a running script.
        const targetId = vm.editingTarget.id;
        const apiKey = this.state.apiKey;
        vm.stopAll();

        this.setState({busy: true, error: false});
        // Detection (decompile) can throw on non-OPMAP blocks — keep it inside
        // the chain so any throw lands in .catch and shows the friendly error.
        Promise.resolve()
            .then(() => {
                // fail-closed: if the pinned sprite was deleted mid-request, do
                // NOT fall back to editingTarget (would edit the wrong sprite).
                const target = vm.runtime.getTargetById(targetId);
                if (!target) throw new Error('vibe: pinned sprite no longer exists');
                const isEmpty = decompile(target.blocks).length === 0;
                const run = isEmpty ? generate : edit;
                return run(vm, {apiKey, instruction, targetId});
            })
            .then(() => this.setState({busy: false, instructionDraft: ''}))
            .catch(err => {
                // eslint-disable-next-line no-console
                console.error('[vibe] request failed:', err);
                this.setState({busy: false, error: true});
            });
    }
    render () {
        return (
            <VibePromptComponent
                busy={this.state.busy}
                error={this.state.error}
                hasKey={Boolean(this.state.apiKey)}
                instructionDraft={this.state.instructionDraft}
                keyDraft={this.state.keyDraft}
                onInstructionDraftChange={this.handleInstructionDraftChange}
                onKeyDraftChange={this.handleKeyDraftChange}
                onResetKey={this.handleResetKey}
                onSubmitInstruction={this.handleSubmitInstruction}
                onSubmitKey={this.handleSubmitKey}
            />
        );
    }
}

VibePrompt.propTypes = {
    vm: PropTypes.instanceOf(VM).isRequired
};

const mapStateToProps = state => ({
    vm: state.scratchGui.vm
});

export {VibePrompt as VibePromptContainer};
export default connect(mapStateToProps)(VibePrompt);
