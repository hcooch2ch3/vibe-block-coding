import {glowChangedBlocks, GLOW_MS, GLOW_CLASS} from '../../../src/lib/ai-harness/glow';

// A fake SVG element exposing just the classList surface glow.js uses.
function fakeEl () {
    const classes = new Set();
    return {
        classList: {
            add: c => classes.add(c),
            remove: c => classes.delete(c),
            contains: c => classes.has(c)
        },
        has: c => classes.has(c)
    };
}

// A fake workspace faithful to the scratch-blocks surface glow.js touches:
// getBlockById(id) → BlockSvg → getSvgRoot() → SVG element. Options let a test
// make an id missing (null block), root-less, or throw (a torn-down block).
function fakeWorkspace (opts = {}) {
    const missing = new Set(opts.missing || []);
    const noRoot = new Set(opts.noRoot || []);
    const throwOnRoot = new Set(opts.throwOnRoot || []);
    const els = {};
    return {
        els,
        getBlockById (id) {
            if (missing.has(id)) return null;
            return {
                getSvgRoot () {
                    if (throwOnRoot.has(id)) throw new Error('block torn down');
                    if (noRoot.has(id)) return null;
                    if (!els[id]) els[id] = fakeEl();
                    return els[id];
                }
            };
        }
    };
}

// Deterministic fake scheduler.
function fakeClock () {
    let cb = null;
    let cleared = null;
    let scheduled = 0;
    let lastDelay = null;
    return {
        cleared: () => cleared,
        scheduled: () => scheduled,
        lastDelay: () => lastDelay,
        setTimeoutFn (fn, ms) { cb = fn; scheduled++; lastDelay = ms; return 'timer-token'; },
        clearTimeoutFn (t) { cleared = t; cb = null; },
        tick () { if (cb) { const f = cb; cb = null; f(); } }
    };
}

const CLK = () => fakeClock();
const opts = (className, clk) => ({className, setTimeoutFn: clk.setTimeoutFn, clearTimeoutFn: clk.clearTimeoutFn});

describe('glowChangedBlocks', () => {
    test('adds the glow class to each id, then removes it after the timer', () => {
        const ws = fakeWorkspace();
        const clk = CLK();
        glowChangedBlocks(ws, ['a', 'b'], opts('g', clk));
        expect(ws.els.a.has('g')).toBe(true);
        expect(ws.els.b.has('g')).toBe(true);
        clk.tick();
        expect(ws.els.a.has('g')).toBe(false);
        expect(ws.els.b.has('g')).toBe(false);
    });

    test('uses GLOW_CLASS by default when no className is given', () => {
        const ws = fakeWorkspace();
        const clk = CLK();
        glowChangedBlocks(ws, ['a'], {setTimeoutFn: clk.setTimeoutFn, clearTimeoutFn: clk.clearTimeoutFn});
        expect(ws.els.a.has(GLOW_CLASS)).toBe(true);
    });

    test('no workspace → no throw, cancel is safe', () => {
        const cancel = glowChangedBlocks(null, ['a']);
        expect(typeof cancel).toBe('function');
        expect(() => cancel()).not.toThrow();
    });

    test('empty ids → nothing glows', () => {
        const ws = fakeWorkspace();
        glowChangedBlocks(ws, [], {});
        expect(Object.keys(ws.els)).toEqual([]);
    });

    test('a non-array topIds → no throw, nothing glows (never-throw contract)', () => {
        const ws = fakeWorkspace();
        const clk = CLK();
        expect(() => glowChangedBlocks(ws, 5, {setTimeoutFn: clk.setTimeoutFn})).not.toThrow();
        expect(() => glowChangedBlocks(ws, null, {setTimeoutFn: clk.setTimeoutFn})).not.toThrow();
        expect(Object.keys(ws.els)).toEqual([]);
        expect(clk.scheduled()).toBe(0);
    });

    test('reducedMotion → nothing glows', () => {
        const ws = fakeWorkspace();
        glowChangedBlocks(ws, ['a'], {reducedMotion: true});
        expect(Object.keys(ws.els)).toEqual([]);
    });

    test('a missing block (getBlockById → null) is skipped, others still glow', () => {
        const ws = fakeWorkspace({missing: ['gone']});
        const clk = CLK();
        glowChangedBlocks(ws, ['gone', 'good'], opts('g', clk));
        expect(ws.els.good.has('g')).toBe(true);
        expect(ws.els.gone).toBeUndefined();
    });

    test('a block whose getSvgRoot throws is skipped (fail-open), others glow', () => {
        const ws = fakeWorkspace({throwOnRoot: ['bad']});
        const clk = CLK();
        expect(() => glowChangedBlocks(ws, ['bad', 'good'], opts('g', clk))).not.toThrow();
        expect(ws.els.good.has('g')).toBe(true);
    });

    test('when no id yields a root, no un-glow timer is armed', () => {
        const ws = fakeWorkspace({noRoot: ['x', 'y']});
        const clk = CLK();
        glowChangedBlocks(ws, ['x', 'y'], opts('g', clk));
        expect(clk.scheduled()).toBe(0); // glowed.length === 0 → early return, no timer
    });

    test('cancel() clears the exact stored timer handle AND removes the glow class', () => {
        const ws = fakeWorkspace();
        const clk = CLK();
        const cancel = glowChangedBlocks(ws, ['a'], opts('g', clk));
        expect(ws.els.a.has('g')).toBe(true);
        cancel();
        expect(clk.cleared()).toBe('timer-token'); // the exact handle setTimeoutFn returned
        expect(ws.els.a.has('g')).toBe(false); // cancel removes the class, not just drops the timer
        clk.tick(); // timer already cleared → no double work
        expect(ws.els.a.has('g')).toBe(false);
    });

    test('a custom glowMs is passed through to the scheduler', () => {
        const ws = fakeWorkspace();
        const clk = CLK();
        glowChangedBlocks(ws, ['a'], {glowMs: 400, className: 'g', setTimeoutFn: clk.setTimeoutFn, clearTimeoutFn: clk.clearTimeoutFn});
        expect(clk.lastDelay()).toBe(400);
    });

    test('exports a default glow duration and class name', () => {
        expect(typeof GLOW_MS).toBe('number');
        expect(GLOW_MS).toBeGreaterThan(0);
        expect(typeof GLOW_CLASS).toBe('string');
        expect(GLOW_CLASS.length).toBeGreaterThan(0);
    });
});
