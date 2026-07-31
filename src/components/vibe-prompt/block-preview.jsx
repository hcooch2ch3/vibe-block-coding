import PropTypes from 'prop-types';
import React from 'react';
import classNames from 'classnames';

import {scriptToXml} from '../../lib/ai-harness/dsl-to-blockly-xml';
import VMScratchBlocks from '../../lib/blocks';

import styles from './block-preview.css';

// Memoize the ScratchBlocks acquisition (and any failure) so a jsdom/SSR throw
// never re-attempts and never escapes — container shallow tests stay safe.
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
        this.setRef = this.setRef.bind(this);
    }
    componentDidMount () {
        this.tryRender();
    }
    componentWillUnmount () {
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
                scrollbars: false,
                zoom: {startScale: 0.7}
            });
            SB.Xml.domToWorkspace(SB.Xml.textToDom(scriptToXml(this.props.script)), this.ws);
        } catch (e) {
            // fail closed — and dispose a workspace that injected before the throw
            // so the defensive path can't leak DOM/listeners.
            if (this.ws) {
                try {
                    this.ws.dispose();
                } catch (e2) { /* already gone */ }
            }
            this.ws = null;
        } finally {
            if (prevMain) SB.mainWorkspace = prevMain;
        }
    }
    render () {
        return (
            <div className={classNames(styles.preview, styles[this.props.variant])}>
                <div
                    className={styles.canvas}
                    ref={this.setRef}
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
