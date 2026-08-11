// Surface B animation: briefly pulse the block stacks that an Apply just added or
// changed, so the child sees WHAT changed on the real canvas.
//
// Mechanism: add a CSS class (see glow.css) to each changed hat's SVG group; the
// class runs a short Scratch-blue pulse, then the class is removed. We drive the
// timing here so the effect is cancelable (re-apply / unmount).
//
// Pure with respect to its dependencies: the caller passes the Blockly workspace
// (or null), the resolved CSS class name, and, in tests, a fake scheduler. It
// never throws (a torn-down block can throw on getSvgRoot); every touch is guarded
// and we fail open (a broken animation must never break Apply).

export const GLOW_MS = 1200;
export const GLOW_CLASS = 'vibe-glow-pulse';
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

const noop = () => {};

// True when the OS "reduce motion" setting is on. Guards Surface B specifically:
// a CSS @media query alone cannot stop us from adding the class, so we also gate here.
const prefersReducedMotion = function () {
    return typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia(REDUCED_MOTION_QUERY).matches;
};

// The SVG group element for a hat id, or null. getBlockById → BlockSvg → getSvgRoot().
const svgRootFor = function (workspace, id) {
    const block = workspace.getBlockById(id);
    return block && typeof block.getSvgRoot === 'function' ? block.getSvgRoot() : null;
};

/**
 * Pulse the given top-block stacks, then stop after glowMs.
 * @param {object|null} workspace - Blockly workspace (getBlockById), or null
 * @param {Array<string>} topIds - hat block ids to pulse
 * @param {object} [opts] - {className, glowMs, reducedMotion, setTimeoutFn, clearTimeoutFn}
 * @returns {Function} cancel, removes the class + clears the timer (always safe to call)
 */
export const glowChangedBlocks = function (workspace, topIds, opts) {
    const o = opts || {};
    const className = o.className || GLOW_CLASS;
    const glowMs = typeof o.glowMs === 'number' ? o.glowMs : GLOW_MS;
    const reducedMotion = typeof o.reducedMotion === 'boolean' ? o.reducedMotion : prefersReducedMotion();
    const setTimeoutFn = o.setTimeoutFn || setTimeout;
    const clearTimeoutFn = o.clearTimeoutFn || clearTimeout;

    // Normalize to an array up front: a non-iterable topIds must not slip past the
    // guard and throw in the loop below (that would break the never-throw contract).
    const ids = Array.isArray(topIds) ? topIds : [];
    if (!workspace || ids.length === 0 || reducedMotion) return noop;

    const glowed = [];
    for (const id of ids) {
        try {
            const root = svgRootFor(workspace, id);
            if (root && root.classList) {
                // runGlow() cancels the prior glow (removing the class) before this
                // runs, so the class is freshly added here, one clean pulse.
                root.classList.add(className);
                glowed.push(root);
            }
        } catch (e) { /* dead id / torn-down SVG, fail open */ }
    }
    if (glowed.length === 0) return noop;

    // Remove the class from the roots we captured. Shared by the timer (normal
    // expiry) AND cancel(), so cancelling on a re-glow or an unmount within the
    // window never STRANDS a pulse, it stops it rather than just dropping the timer.
    const unglow = function () {
        for (const root of glowed) {
            try {
                root.classList.remove(className);
            } catch (e) { /* element detached since, nothing to remove */ }
        }
    };
    const timer = setTimeoutFn(unglow, glowMs);

    return () => {
        clearTimeoutFn(timer);
        unglow();
    };
};
