// Surface B animation: briefly glow the block stacks that an Apply just added or
// changed, so the child sees WHAT changed on the real canvas.
//
// Pure with respect to its dependencies: the caller passes the Blockly workspace
// (or null) and, in tests, a fake scheduler. It never throws — scratch-blocks'
// glowStack(id, true) THROWS on a missing id, so every call is guarded and we
// fail open (a broken animation must never break Apply).

export const GLOW_MS = 1200;
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

const noop = () => {};

// True when the OS "reduce motion" setting is on. Guards Surface B specifically:
// a CSS @media query cannot reach this JS-driven glow (that only covers Surface A).
const prefersReducedMotion = function () {
    return typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia(REDUCED_MOTION_QUERY).matches;
};

/**
 * Glow the given top-block stacks, then un-glow them after glowMs.
 * @param {object|null} workspace - Blockly workspace (glowStack + getBlockById), or null
 * @param {Array<string>} topIds - hat block ids to glow
 * @param {object} [opts] - {glowMs, reducedMotion, setTimeoutFn, clearTimeoutFn}
 * @returns {Function} cancel — clears the pending un-glow timer (always safe to call)
 */
export const glowChangedBlocks = function (workspace, topIds, opts) {
    const o = opts || {};
    const glowMs = typeof o.glowMs === 'number' ? o.glowMs : GLOW_MS;
    const reducedMotion = typeof o.reducedMotion === 'boolean' ? o.reducedMotion : prefersReducedMotion();
    const setTimeoutFn = o.setTimeoutFn || setTimeout;
    const clearTimeoutFn = o.clearTimeoutFn || clearTimeout;

    // Normalize to an array up front: a non-iterable topIds must not slip past the
    // guard and throw in the loop below (that would break the never-throw contract).
    const ids = Array.isArray(topIds) ? topIds : [];
    if (!workspace || ids.length === 0 || reducedMotion) return noop;

    const glowing = [];
    for (const id of ids) {
        try {
            workspace.glowStack(id, true); // THROWS on a missing id → skip that one
            glowing.push(id);
        } catch (e) { /* dead id / torn-down SVG — fail open */ }
    }
    if (glowing.length === 0) return noop;

    const timer = setTimeoutFn(() => {
        for (const id of glowing) {
            try {
                if (workspace.getBlockById(id)) workspace.glowStack(id, false);
            } catch (e) { /* block gone since — nothing to un-glow */ }
        }
    }, glowMs);

    return () => clearTimeoutFn(timer);
};
