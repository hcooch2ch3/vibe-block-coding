import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import {connect} from 'react-redux';
import VM from 'scratch-vm';

import VibePromptComponent from '../components/vibe-prompt/vibe-prompt.jsx';
import {generate, edit} from '../lib/ai-harness/dev-console';
import {decompile} from '../lib/ai-harness/dsl';
import {diff} from '../lib/ai-harness/edit';
import {loadKey, saveKey} from '../lib/ai-harness/key-store';
import {loadHistory, saveHistory} from '../lib/ai-harness/history-store';
import {
    loadPrefs, savePrefs, clampPosition, defaultPosition,
    HEADER_H, DEFAULT_CARD_H, DEFAULT_W, MIN_W, MIN_H, EDGE_MARGIN, MENU_BAR_TOP
} from '../lib/ai-harness/ui-prefs';

class VibePrompt extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleKeyDraftChange',
            'handleInstructionDraftChange',
            'handleSubmitKey',
            'handleSubmitInstruction',
            'handleChipClick',
            'handleRetry',
            'handleToggleCollapse',
            'handleDragStop',
            'handleResize',
            'handleClearHistory',
            'handleEditKey',
            'handleBackFromKey',
            'handleResizeStart',
            'handleResizeMove',
            'handleResizeStop'
        ]);
        const history = loadHistory();
        this.nextHistoryId = history.length ? Math.max(...history.map(e => e.id)) + 1 : 0;
        const viewport = {innerWidth: window.innerWidth, innerHeight: window.innerHeight};
        const prefs = loadPrefs();
        const collapsed = prefs ? prefs.collapsed : false;
        // Clamp against the VISIBLE height so an expanded card can't rest with its
        // body below the viewport bottom (only the header would be reachable).
        const position = prefs ?
            clampPosition({x: prefs.x, y: prefs.y}, viewport, collapsed ? HEADER_H : DEFAULT_CARD_H) :
            defaultPosition(viewport);
        const size = {
            w: (prefs && prefs.w) ? prefs.w : DEFAULT_W,
            h: (prefs && prefs.h) ? prefs.h : null // null = content-driven until resized
        };
        this.state = {
            apiKey: loadKey(),
            keyDraft: '',
            instructionDraft: '',
            busy: false,
            error: false,
            editingKey: false,
            lastInstruction: null,
            collapsed,
            position,
            size,
            history
        };
    }
    componentDidMount () {
        // Re-clamp on resize so a card near an edge can't be stranded off-screen
        // (bounds="parent" only constrains an ACTIVE drag) — dual-review Task 4.
        window.addEventListener('resize', this.handleResize);
    }
    componentWillUnmount () {
        window.removeEventListener('resize', this.handleResize);
        window.removeEventListener('mousemove', this.handleResizeMove);
        window.removeEventListener('mouseup', this.handleResizeStop);
    }
    handleResize () {
        const viewport = {innerWidth: window.innerWidth, innerHeight: window.innerHeight};
        this.setState(prevState => ({
            position: clampPosition(
                prevState.position,
                viewport,
                prevState.collapsed ? HEADER_H : DEFAULT_CARD_H
            )
        }));
    }
    handleKeyDraftChange (e) {
        this.setState({keyDraft: e.target.value, error: false});
    }
    handleInstructionDraftChange (e) {
        // clear a stale error as soon as the child starts revising (Task 2 review)
        this.setState({instructionDraft: e.target.value, error: false});
    }
    handleChipClick (text) {
        // Fill only — never auto-run. The child owns pressing Send (educational,
        // avoids accidental API spend, two-tap demo). Clear any stale error.
        this.setState({instructionDraft: text, error: false});
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
        this.setState({apiKey: key, keyDraft: '', error: false, editingKey: false});
    }
    handleEditKey () {
        // Switch to the key-entry screen WITHOUT clearing the current key, so the
        // child can back out (handleBackFromKey) and keep their existing key.
        if (this.state.busy) return;
        this.setState({editingKey: true, keyDraft: '', error: false});
    }
    handleBackFromKey () {
        // Cancel key editing and return to the instruction view (key preserved).
        this.setState({editingKey: false, keyDraft: '', error: false});
    }
    handleToggleCollapse () {
        this.setState(prevState => {
            const collapsed = !prevState.collapsed;
            // On expand, re-clamp so the newly-shown body isn't below the fold.
            const viewport = {innerWidth: window.innerWidth, innerHeight: window.innerHeight};
            const position = collapsed ?
                prevState.position :
                clampPosition(prevState.position, viewport, DEFAULT_CARD_H);
            // savePrefs defaults to window.localStorage (guarded), matching how
            // the container calls saveKey — no explicit storage arg. Carry size so
            // a collapse/drag never drops a stored width/height.
            savePrefs({...position, collapsed, w: prevState.size.w, h: prevState.size.h});
            return {collapsed, position};
        });
    }
    handleDragStop (e, data) {
        // react-draggable already applied bounds="parent" for live drag; persist
        // the resting spot. clampPosition is the load-time guard for stale coords.
        const position = {x: data.x, y: data.y};
        this.setState(prevState => {
            savePrefs({...position, collapsed: prevState.collapsed, w: prevState.size.w, h: prevState.size.h});
            return {position};
        });
    }
    handleResizeStart (e) {
        // Any edge/corner can resize. `data-dir` (n/s/e/w combos) says which sides
        // move; the opposite sides stay fixed. Capture the card's real rectangle
        // now (getBoundingClientRect handles content-driven auto-height correctly).
        e.preventDefault();
        e.stopPropagation();
        const dir = e.currentTarget.dataset.dir || 'se';
        const rect = e.currentTarget.parentNode.getBoundingClientRect();
        this.resizeCtx = {dir, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom};
        window.addEventListener('mousemove', this.handleResizeMove);
        window.addEventListener('mouseup', this.handleResizeStop);
    }
    handleResizeMove (e) {
        const ctx = this.resizeCtx;
        if (!ctx) return;
        const d = ctx.dir;
        let {left, top, right, bottom} = ctx;
        if (d.indexOf('e') >= 0) right = e.clientX;
        if (d.indexOf('w') >= 0) left = e.clientX;
        if (d.indexOf('s') >= 0) bottom = e.clientY;
        if (d.indexOf('n') >= 0) top = e.clientY;
        // keep the card on-screen (below the menu bar), then enforce the minimum
        // by pushing the MOVING edge, so the fixed edge never jumps.
        left = Math.max(EDGE_MARGIN, Math.min(left, window.innerWidth - EDGE_MARGIN));
        right = Math.min(window.innerWidth - EDGE_MARGIN, Math.max(right, EDGE_MARGIN));
        top = Math.max(MENU_BAR_TOP, Math.min(top, window.innerHeight - EDGE_MARGIN));
        bottom = Math.min(window.innerHeight - EDGE_MARGIN, Math.max(bottom, MENU_BAR_TOP));
        if (right - left < MIN_W) {
            if (d.indexOf('w') >= 0) left = right - MIN_W; else right = left + MIN_W;
        }
        if (bottom - top < MIN_H) {
            if (d.indexOf('n') >= 0) top = bottom - MIN_H; else bottom = top + MIN_H;
        }
        this.setState({position: {x: left, y: top}, size: {w: right - left, h: bottom - top}});
    }
    handleResizeStop () {
        window.removeEventListener('mousemove', this.handleResizeMove);
        window.removeEventListener('mouseup', this.handleResizeStop);
        this.resizeCtx = null;
        const {position, collapsed, size} = this.state;
        savePrefs({...position, collapsed, w: size.w, h: size.h});
    }
    runInstruction (instruction, targetId) {
        // Enforce the busy invariant in the primitive itself, not only in the
        // callers — so a future caller can't re-introduce a double-submit /
        // stop-threads-mid-request (dual-review Task 3, defense-in-depth).
        if (this.state.busy) return Promise.resolve();
        const vm = this.props.vm;
        const apiKey = this.state.apiKey;
        // Stop threads so applyEdit's deleteBlock can't orphan a running script.
        vm.stopAll();
        this.setState({busy: true, error: false});
        // Detection (decompile) can throw on non-OPMAP blocks — keep it inside
        // the chain so any throw lands in .catch and shows the friendly error.
        let before = [];
        return Promise.resolve()
            .then(() => {
                // fail-closed: never fall back to editingTarget if the pinned
                // sprite was deleted mid-request (would edit the wrong sprite).
                const target = vm.runtime.getTargetById(targetId);
                if (!target) throw new Error('vibe: pinned sprite no longer exists');
                before = decompile(target.blocks);
                const isEmpty = before.length === 0;
                const run = isEmpty ? generate : edit;
                return run(vm, {apiKey, instruction, targetId});
            })
            .then(after => {
                this.appendHistory(instruction, before, after, 'done');
                this.setState({busy: false, instructionDraft: ''});
            })
            .catch(err => {
                // eslint-disable-next-line no-console
                console.error('[vibe] request failed:', err);
                this.appendHistory(instruction, [], [], 'failed');
                this.setState({busy: false, error: true});
            });
    }
    appendHistory (instruction, before, after, status) {
        let changes = [];
        if (status === 'done') {
            changes = diff(before, after).reduce((acc, op) => {
                if (op.type === 'add') acc.push({kind: 'added', script: op.script});
                else if (op.type === 'replace') acc.push({kind: 'updated', script: op.script});
                else if (op.type === 'remove') acc.push({kind: 'removed', script: before[op.index]});
                return acc;
            }, []);
        }
        const entry = {id: this.nextHistoryId++, instruction, changes, status};
        const history = this.state.history.concat(entry);
        saveHistory(history);
        this.setState({history});
    }
    handleClearHistory () {
        saveHistory([]);
        this.setState({history: []});
    }
    handleSubmitInstruction (e) {
        e.preventDefault();
        const instruction = this.state.instructionDraft.trim();
        const vm = this.props.vm;
        if (!instruction || this.state.busy || !this.state.apiKey ||
            !vm || !vm.editingTarget) {
            return;
        }
        // Pin the sprite now AND remember it so Try-again replays the SAME target
        // even if the child switches sprites after an error.
        const targetId = vm.editingTarget.id;
        this.setState({lastInstruction: {instruction, targetId}});
        this.runInstruction(instruction, targetId);
    }
    handleRetry () {
        const last = this.state.lastInstruction;
        if (!last || this.state.busy || !this.state.apiKey) return;
        this.runInstruction(last.instruction, last.targetId);
    }
    render () {
        return (
            <VibePromptComponent
                busy={this.state.busy}
                canCancelKey={Boolean(this.state.apiKey)}
                error={this.state.error}
                hasKey={Boolean(this.state.apiKey) && !this.state.editingKey}
                instructionDraft={this.state.instructionDraft}
                keyDraft={this.state.keyDraft}
                onInstructionDraftChange={this.handleInstructionDraftChange}
                onKeyDraftChange={this.handleKeyDraftChange}
                collapsed={this.state.collapsed}
                position={this.state.position}
                size={this.state.size}
                history={this.state.history}
                vm={this.props.vm}
                onCancelKey={this.handleBackFromKey}
                onEditKey={this.handleEditKey}
                onChipClick={this.handleChipClick}
                onClearHistory={this.handleClearHistory}
                onRetry={this.handleRetry}
                onToggleCollapse={this.handleToggleCollapse}
                onDragStop={this.handleDragStop}
                onResizeStart={this.handleResizeStart}
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
