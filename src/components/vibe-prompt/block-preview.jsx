import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import classNames from 'classnames';

import {scriptToXml} from '../../lib/ai-harness/dsl-to-blockly-xml';
import VMScratchBlocks from '../../lib/blocks';

import styles from './block-preview.css';

// Box (visible) height bounds. The inner canvas is sized to the FULL block
// height so nothing is clipped at the SVG level; the frame is what the child
// resizes, and CSS overflow provides the scrollbar when the frame is shorter.
const MIN_BOX_H = 44;
const MAX_BOX_H = 600;
const DEFAULT_BOX_H = 88; // fallback before the blocks are measured
const DEFAULT_CAP_H = 140; // auto-fit up to this; taller content starts scrolled
const CONTENT_PAD = 12; // breathing room under the last block
const TOP_MARGIN = 24; // workspace-unit inset so the hat block's decorative top cap isn't clipped

// Memoize the ScratchBlocks acquisition (and any failure) so a jsdom/SSR throw
// never re-attempts and never escapes, container shallow tests stay safe.
let cachedSB;
let sbFailed = false;
const getScratchBlocks = function (vm) {
    if (sbFailed) return null;
    if (cachedSB) return cachedSB;
    try {
        cachedSB = VMScratchBlocks(vm, false);
        return cachedSB;
    } catch (e) {
        sbFailed = true;
        return null;
    }
};

class BlockPreview extends React.Component {
    constructor (props) {
        super(props);
        // boxH = user-chosen visible height (null → auto-fit content up to the
        // cap). contentH = measured full block height (null until rendered).
        this.state = {boxH: null, contentH: null};
        this.gripCtx = null;
        bindAll(this, ['setRef', 'handleGripStart', 'handleGripMove', 'handleGripStop']);
    }
    componentDidMount () {
        this.tryRender();
    }
    componentDidUpdate (prevProps, prevState) {
        // The inner canvas height follows contentH (inline style, already in the
        // DOM by now); tell Blockly to resize its SVG to match so every block is
        // inside the SVG and the frame's CSS overflow can scroll to reach them.
        if (this.ws && this.state.contentH !== prevState.contentH) {
            const SB = getScratchBlocks(this.props.vm);
            if (SB) {
                try {
                    SB.svgResize(this.ws);
                } catch (e) { /* container gone / not laid out */ }
            }
        }
    }
    componentWillUnmount () {
        this.removeGripListeners();
        if (this.ws) {
            try {
                this.ws.dispose();
            } catch (e) {
                // already gone
            }
            this.ws = null;
        }
    }
    setRef (el) {
        this.ref = el;
    }
    tryRender () {
        const SB = getScratchBlocks(this.props.vm);
        if (!SB || !this.ref) return; // fail closed → placeholder stays
        // scratch-blocks is a global singleton shared with the live editor, and
        // inject() unconditionally repoints Blockly.mainWorkspace at whatever it
        // just created. Snapshot the editor's workspace and restore it after, so
        // document-level resize/keyboard handlers keep targeting the real canvas
        // rather than this read-only preview.
        const prevMain = SB.mainWorkspace;
        try {
            this.ws = SB.inject(this.ref, {
                readOnly: true,
                media: 'static/blocks-media/default/',
                scrollbars: false, // the frame's CSS overflow scrolls, not Blockly
                zoom: {startScale: 0.7}
            });
            SB.Xml.domToWorkspace(SB.Xml.textToDom(scriptToXml(this.props.script)), this.ws);
            // Anchor the stack a small margin in from the top-left so the hat
            // block's rounded top isn't clipped at the SVG edge (domToWorkspace's
            // default position can put y at/above 0 → the top was getting cut).
            const top = this.ws.getTopBlocks(false)[0];
            if (top) {
                const bb = this.ws.getBlocksBoundingBox();
                top.moveBy(TOP_MARGIN - bb.x, TOP_MARGIN - bb.y);
            }
            // Measure the rendered stack so the canvas can be exactly tall enough
            // (getBlocksBoundingBox is in workspace units → multiply by scale).
            const bbox = this.ws.getBlocksBoundingBox();
            const scale = this.ws.scale || 0.7;
            const contentH = Math.max(
                MIN_BOX_H,
                Math.ceil(((bbox.y + bbox.height) * scale)) + CONTENT_PAD
            );
            this.setState({contentH});
        } catch (e) {
            // fail closed, and dispose a workspace that injected before the throw
            // so the defensive path can't leak DOM/listeners.
            if (this.ws) {
                try {
                    this.ws.dispose();
                } catch (e2) { /* already gone */ }
            }
            this.ws = null;
        } finally {
            // Restore unconditionally (even to null): if a preview ever injects
            // before the live editor's workspace exists, a `prevMain` guard would
            // leave the global mainWorkspace pointing at this read-only preview.
            SB.mainWorkspace = prevMain || null;
        }
    }
    // Current visible frame height in px: the child's choice, else auto-fit the
    // measured content up to the cap, else the pre-measure fallback.
    frameHeight () {
        if (this.state.boxH !== null) return this.state.boxH;
        if (this.state.contentH !== null) return Math.min(this.state.contentH, DEFAULT_CAP_H);
        return DEFAULT_BOX_H;
    }
    handleGripStart (e) {
        // Drag the bottom-right grip to grow/shrink the visible height. Mirrors
        // the card's resize: mouse + touch, preventDefault to stop the emulated
        // mouse cascade (React 16 is non-passive) and page scroll under a finger.
        e.preventDefault();
        e.stopPropagation();
        const p = e.touches ? e.touches[0] : e;
        this.gripCtx = {startY: p.clientY, startH: this.frameHeight()};
        if (e.touches) {
            window.addEventListener('touchmove', this.handleGripMove, {passive: false});
            window.addEventListener('touchend', this.handleGripStop);
            window.addEventListener('touchcancel', this.handleGripStop);
        } else {
            window.addEventListener('mousemove', this.handleGripMove);
            window.addEventListener('mouseup', this.handleGripStop);
        }
    }
    handleGripMove (e) {
        const ctx = this.gripCtx;
        if (!ctx) return;
        const p = e.touches ? e.touches[0] : e;
        if (!p) return; // defensive: no active touch point
        if (e.touches && e.cancelable) e.preventDefault(); // block page scroll while dragging
        const boxH = Math.max(MIN_BOX_H, Math.min(MAX_BOX_H, ctx.startH + (p.clientY - ctx.startY)));
        this.setState({boxH});
    }
    handleGripStop () {
        this.removeGripListeners();
        this.gripCtx = null;
    }
    removeGripListeners () {
        window.removeEventListener('mousemove', this.handleGripMove);
        window.removeEventListener('mouseup', this.handleGripStop);
        window.removeEventListener('touchmove', this.handleGripMove);
        window.removeEventListener('touchend', this.handleGripStop);
        window.removeEventListener('touchcancel', this.handleGripStop);
    }
    render () {
        const canvasH = this.state.contentH === null ? DEFAULT_BOX_H : this.state.contentH;
        return (
            <div
                className={classNames(styles.preview, styles[this.props.variant])}
                style={{height: this.frameHeight()}}
            >
                <div className={styles.scroll}>
                    <div
                        className={styles.canvas}
                        style={{height: canvasH}}
                        ref={this.setRef}
                    />
                </div>
                <div
                    className={styles.grip}
                    title="Drag to resize"
                    onMouseDown={this.handleGripStart}
                    onTouchStart={this.handleGripStart}
                />
            </div>
        );
    }
}

BlockPreview.propTypes = {
    script: PropTypes.shape({hat: PropTypes.string, body: PropTypes.array}).isRequired,
    variant: PropTypes.oneOf(['added', 'removed', 'updated']).isRequired,
    vm: PropTypes.object
};

export default BlockPreview;
