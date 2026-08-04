import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import {connect} from 'react-redux';
import VM from 'scratch-vm';

import VibePromptComponent from '../components/vibe-prompt/vibe-prompt.jsx';
import {propose, applyProposal} from '../lib/ai-harness/dev-console';
import {glowChangedBlocks} from '../lib/ai-harness/glow';
import glowStyles from '../lib/ai-harness/glow.css';
import VMScratchBlocks from '../lib/blocks';
import {loadKey, saveKey} from '../lib/ai-harness/key-store';
import {loadChat, saveChat} from '../lib/ai-harness/chat-store';
import {
    loadPrefs, savePrefs, clampPosition, defaultPosition, clampSize,
    HEADER_H, DEFAULT_CARD_H, DEFAULT_W, MIN_W, MIN_H, EDGE_MARGIN, MENU_BAR_TOP,
    DEFAULT_CONTEXT_TURNS
} from '../lib/ai-harness/ui-prefs';

// Task 0 gate: route the model's envelope through the answer/proposal split
// (a text reply stays an answer; edits become a pending proposal). Shipped true.
// WARNING: do NOT flip to false — the false path is NOT yet implemented. With
// AUTO_CLASSIFY===false the ternary below routes every turn (including real
// proposals) to the answer branch and drops the proposal's ops entirely. An explicit
// Build/Ask control must be built (see plan addendum) BEFORE this flag is flipped.
const AUTO_CLASSIFY = true;

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
            'handleApply',
            'handleIgnore',
            'handleRebuild',
            'handleMakeIt',
            'handleContextTurnsChange',
            'handleToggleCollapse',
            'handleDragStop',
            'handleResize',
            'handleClearHistory',
            'handleToggleExamples',
            'handleEditKey',
            'handleBackFromKey',
            'handleResizeStart',
            'handleResizeMove',
            'handleResizeStop'
        ]);
        const turns = loadChat();
        // seed the id counter from the max EXISTING numeric id (a corrupt/legacy
        // non-numeric id would otherwise make Math.max NaN → duplicate React keys).
        const ids = turns.map(t => t.id).filter(Number.isFinite);
        this.nextId = ids.length ? Math.max(...ids) + 1 : 0;
        // Single-flight Apply guard: an INSTANCE field (not state) so two Apply
        // clicks in the same tick are rejected synchronously, before the awaited
        // applyProposal can double-inject.
        this.applying = false;
        // Cancel handle for the current canvas glow (Surface B). Cleared on
        // re-apply and unmount so a pending un-glow never fires on a dead workspace.
        this.cancelGlow = null;
        const viewport = {innerWidth: window.innerWidth, innerHeight: window.innerHeight};
        const prefs = loadPrefs();
        const collapsed = prefs ? prefs.collapsed : false;
        // Clamp against the VISIBLE height so an expanded card can't rest with its
        // body below the viewport bottom (only the header would be reachable).
        const position = prefs ?
            clampPosition({x: prefs.x, y: prefs.y}, viewport, collapsed ? HEADER_H : DEFAULT_CARD_H) :
            defaultPosition(viewport);
        let size = {
            w: (prefs && prefs.w) ? prefs.w : DEFAULT_W,
            h: (prefs && prefs.h) ? prefs.h : null // null = content-driven until resized
        };
        // Clamp a stored size into the current viewport (and guard corrupt/legacy
        // negative or oversized values) so a card saved on a big screen or a bad
        // write can't load off-screen or broken.
        const maxLoadW = Math.max(MIN_W, viewport.innerWidth - (2 * EDGE_MARGIN));
        size.w = Math.max(MIN_W, Math.min(size.w, maxLoadW));
        if (size.h) size = clampSize(size, viewport);
        this.state = {
            apiKey: loadKey(),
            keyDraft: '',
            instructionDraft: '',
            busy: false,
            error: false,
            editingKey: false,
            lastInstruction: null,
            contextTurns: prefs ? prefs.contextTurns : DEFAULT_CONTEXT_TURNS,
            collapsed,
            position,
            size,
            turns,
            examplesOpen: false
        };
    }
    componentDidMount () {
        // Re-clamp on resize so a card near an edge can't be stranded off-screen
        // (bounds="parent" only constrains an ACTIVE drag) — dual-review Task 4.
        window.addEventListener('resize', this.handleResize);
    }
    componentWillUnmount () {
        window.removeEventListener('resize', this.handleResize);
        this.removeResizeListeners();
        if (this.cancelGlow) this.cancelGlow();
    }
    removeResizeListeners () {
        // removeEventListener on a listener that was never added is a no-op, so we
        // can drop both the mouse and touch pairs unconditionally.
        window.removeEventListener('mousemove', this.handleResizeMove);
        window.removeEventListener('mouseup', this.handleResizeStop);
        window.removeEventListener('touchmove', this.handleResizeMove);
        window.removeEventListener('touchend', this.handleResizeStop);
        window.removeEventListener('touchcancel', this.handleResizeStop);
    }
    handleResize () {
        const viewport = {innerWidth: window.innerWidth, innerHeight: window.innerHeight};
        this.setState(prevState => {
            let size = prevState.size;
            if (size.h) {
                size = clampSize(size, viewport); // a resized card follows the new viewport
            } else {
                const maxW = Math.max(MIN_W, viewport.innerWidth - (2 * EDGE_MARGIN));
                if (size.w > maxW) size = {w: maxW, h: null};
            }
            const clampH = size.h || (prevState.collapsed ? HEADER_H : DEFAULT_CARD_H);
            return {size, position: clampPosition(prevState.position, viewport, clampH)};
        });
    }
    handleKeyDraftChange (e) {
        this.setState({keyDraft: e.target.value, error: false});
    }
    handleInstructionDraftChange (e) {
        // clear a stale error as soon as the child starts revising (Task 2 review)
        this.setState({instructionDraft: e.target.value, error: false});
    }
    handleChipClick (text) {
        // One-tap: an example chip fills AND sends immediately (auto-submit). The
        // shared submit path appends the user turn, clears the draft, and closes the
        // examples sheet. A busy request is the only thing that makes this a no-op.
        this.submitInstruction(text);
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
            return {collapsed, position, examplesOpen: false};
        });
    }
    handleToggleExamples () {
        // Transient UI flag for the floating examples sheet (history view only).
        // Not persisted — the empty-chat welcome is derived from turns.length.
        // Reset to false by chip-pick / submit / clear / collapse; a card DRAG
        // deliberately keeps it open (a non-destructive reposition — the sheet
        // lives inside the card body and moves with it).
        this.setState(prevState => ({examplesOpen: !prevState.examplesOpen}));
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
        // NOTE: on touch, the preventDefault above suppresses the browser's
        // emulated mouse events (mousedown->mouseup) so they don't re-enter here
        // via onMouseDown and double-register the listeners. This relies on React
        // 16 attaching touch listeners NON-passive. If this fork is ever bumped to
        // React 17+ (passive-by-default touch roots), preventDefault becomes a
        // no-op here and that guard must move to a ref-based native touchstart.
        if (e.touches) {
            // passive:false so the touchmove handler is allowed to preventDefault
            // and stop the page from scrolling under the finger while resizing.
            window.addEventListener('touchmove', this.handleResizeMove, {passive: false});
            window.addEventListener('touchend', this.handleResizeStop);
            window.addEventListener('touchcancel', this.handleResizeStop);
        } else {
            window.addEventListener('mousemove', this.handleResizeMove);
            window.addEventListener('mouseup', this.handleResizeStop);
        }
    }
    handleResizeMove (e) {
        const ctx = this.resizeCtx;
        if (!ctx) return;
        // A touch event carries its point in touches[0], not on the event itself.
        const p = e.touches ? e.touches[0] : e;
        if (!p) return; // defensive: no active touch point (e.g. touches:[]) — nothing to track
        // On touch, block the page scroll/zoom while dragging a grip.
        if (e.touches && e.cancelable) e.preventDefault();
        const d = ctx.dir;
        let {left, top, right, bottom} = ctx;
        if (d.indexOf('e') >= 0) right = p.clientX;
        if (d.indexOf('w') >= 0) left = p.clientX;
        if (d.indexOf('s') >= 0) bottom = p.clientY;
        if (d.indexOf('n') >= 0) top = p.clientY;
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
        this.removeResizeListeners();
        this.resizeCtx = null;
        const {position, collapsed, size} = this.state;
        savePrefs({...position, collapsed, w: size.w, h: size.h});
    }
    buildHistoryWindow () {
        // Last `contextTurns` round-trips of {role, text} ONLY — never the preview
        // block payload or baseStamp (they'd bloat the prompt and leak internals).
        // length <= contextTurns*2 (a round-trip is a user turn + an ai turn).
        // Guard n===0: slice(-0) === slice(0) === the whole array, so we must
        // short-circuit — "remember 0 turns" must send an empty context window.
        const n = this.state.contextTurns;
        const win = n > 0 ? this.state.turns.slice(-n * 2) : [];
        return win.map(t => ({role: t.role, text: t.text}));
    }
    // Immutably flip one turn's status by id, then persist. Used by apply / ignore.
    setTurnStatus (id, status) {
        this.setState(prev => {
            const turns = prev.turns.map(t => (t.id === id ? Object.assign({}, t, {status}) : t));
            saveChat(turns);
            return {turns};
        });
    }
    // Re-run propose against the CURRENT workspace for the given pinned target and
    // append a NEW turn (pending proposal or answer). Shared by submit's success
    // tail, retry, rebuild and make-it. Does NOT push a user turn or read the draft.
    runProposeFor (instruction, targetId) {
        if (this.state.busy || !this.state.apiKey) return Promise.resolve();
        const vm = this.props.vm;
        this.setState({busy: true, error: false, lastInstruction: {instruction, targetId}});
        const history = this.buildHistoryWindow();
        return Promise.resolve()
            .then(() => propose(vm, {apiKey: this.state.apiKey, instruction, targetId, history}))
            .then(({answer, proposal}) => {
                // AUTO_CLASSIFY true (shipped) → keep the model's answer/proposal
                // split. The false path is NOT yet implemented: flipping the flag
                // currently routes every turn to the answer branch and drops
                // the proposal's ops — an explicit Build/Ask control must be built
                // (see plan addendum) before the flag is changed.
                const aiTurn = (AUTO_CLASSIFY && proposal) ?
                    {
                        id: this.nextId++,
                        role: 'ai',
                        kind: 'proposal',
                        text: answer || '',
                        instruction,
                        targetId,
                        preview: proposal,
                        baseStamp: proposal.baseStamp,
                        status: 'pending'
                    } :
                    {
                        id: this.nextId++,
                        role: 'ai',
                        kind: 'answer',
                        text: answer || '',
                        instruction,
                        targetId
                    };
                this.setState(prev => {
                    const turns = prev.turns.concat(aiTurn);
                    saveChat(turns);
                    return {turns, busy: false};
                });
            })
            .catch(err => {
                // network / parse / empty-envelope / deleted-pinned-sprite (propose
                // throws) → error state; lastInstruction is kept for Try-again.
                // eslint-disable-next-line no-console
                console.error('[vibe] propose failed:', err);
                this.setState({busy: false, error: true});
            });
    }
    handleClearHistory () {
        saveChat([]);
        this.setState({turns: [], examplesOpen: false});
    }
    handleSubmitInstruction (e) {
        e.preventDefault();
        this.submitInstruction(this.state.instructionDraft);
    }
    // Shared send path for the composer form AND one-tap example chips. Appends a
    // user turn, clears the draft, closes the examples sheet, and kicks off propose.
    submitInstruction (instruction) {
        const text = (instruction || '').trim();
        const vm = this.props.vm;
        if (!text || this.state.busy || !this.state.apiKey || !vm || !vm.editingTarget) return;
        // Pin the sprite NOW; propose/apply use this id even if the child switches
        // sprites mid-request. A deleted pinned sprite → propose throws → error.
        const targetId = vm.editingTarget.id;
        // Append ONLY a user turn; never injects and never stopAll()s (that moved into
        // applyProposal). Clear the draft immediately so the child sees their message
        // land and can't double-submit the same text.
        const userTurn = {id: this.nextId++, role: 'user', text};
        this.setState(prev => {
            const turns = prev.turns.concat(userTurn);
            saveChat(turns);
            return {turns, instructionDraft: '', examplesOpen: false};
        });
        this.runProposeFor(text, targetId);
    }
    handleApply (turn) {
        // HARD GATE 1 — single-flight: a synchronous instance flag so two Apply
        // clicks in the same tick call applyProposal only ONCE (a child mashing the
        // button must not double-inject).
        if (this.applying || !turn || !turn.preview) return;
        this.applying = true;
        this.setState({busy: true});
        const vm = this.props.vm;
        Promise.resolve()
            .then(() => applyProposal(vm, turn.preview))
            // ok → applied; stale (workspace changed since propose) → stale.
            .then(res => {
                this.setTurnStatus(turn.id, res.ok ? 'applied' : 'stale');
                // Surface B glow runs AFTER status is set, isolated in runGlow — a
                // glow throw can never reach the .catch below and mislabel a good Apply.
                if (res.ok) this.runGlow(res.changedTopIds);
            })
            // HARD GATE 2 — catch → Rebuild: applyEdit is non-atomic (delete-loop then
            // inject-loop, no rollback). A reject may leave the workspace dirty, so
            // mark the turn stale (child rebuilds) rather than crash.
            .catch(err => {
                // eslint-disable-next-line no-console
                console.error('[vibe] apply failed:', err);
                this.setTurnStatus(turn.id, 'stale');
            })
            // Clear the single-flight flag and busy on BOTH success and reject.
            .then(() => {
                this.applying = false;
                this.setState({busy: false});
            });
    }
    // Surface B: glow the stacks this Apply changed. Fully isolated + fail-open —
    // acquiring the workspace or glowing must NEVER throw into the apply-status
    // chain (glowStack throws on a missing id). cat-blocks mode uses a different
    // Blockly singleton whose mainWorkspace may be null → the null-check skips glow.
    runGlow (changedTopIds) {
        if (!changedTopIds || changedTopIds.length === 0) return;
        try {
            const SB = VMScratchBlocks(this.props.vm, false);
            const ws = SB && SB.getMainWorkspace ? SB.getMainWorkspace() : null;
            if (this.cancelGlow) this.cancelGlow();
            this.cancelGlow = glowChangedBlocks(ws, changedTopIds, {className: glowStyles.pulse});
        } catch (e) {
            // fail-open: animation is decoration; Apply already succeeded.
        }
    }
    handleIgnore (turn) {
        if (!turn) return;
        this.setTurnStatus(turn.id, 'ignored'); // terminal
    }
    handleRebuild (turn) {
        if (!turn) return;
        this.runProposeFor(turn.instruction, turn.targetId); // append NEW pending, keep the old turn
    }
    handleMakeIt (turn) {
        if (!turn) return;
        this.runProposeFor(turn.instruction, turn.targetId);
    }
    handleRetry () {
        // Replay the PINNED instruction+target after a FAILED turn (network/parse).
        // Routes through runProposeFor so it pushes NO duplicate user turn.
        const last = this.state.lastInstruction;
        if (!last || this.state.busy || !this.state.apiKey) return;
        this.runProposeFor(last.instruction, last.targetId);
    }
    handleContextTurnsChange (n) {
        // Task 10 wires the slider UI; the handler + state live here. Persist the
        // FULL prefs object — never a partial {contextTurns} write (regression guard).
        const {position, collapsed, size} = this.state;
        this.setState({contextTurns: n});
        savePrefs({...position, collapsed, w: size.w, h: size.h, contextTurns: n});
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
                turns={this.state.turns}
                contextTurns={this.state.contextTurns}
                vm={this.props.vm}
                onCancelKey={this.handleBackFromKey}
                onEditKey={this.handleEditKey}
                onChipClick={this.handleChipClick}
                onClearHistory={this.handleClearHistory}
                onApply={this.handleApply}
                onIgnore={this.handleIgnore}
                onRebuild={this.handleRebuild}
                onMakeIt={this.handleMakeIt}
                onContextTurnsChange={this.handleContextTurnsChange}
                onRetry={this.handleRetry}
                onToggleCollapse={this.handleToggleCollapse}
                onToggleExamples={this.handleToggleExamples}
                examplesOpen={this.state.examplesOpen}
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
