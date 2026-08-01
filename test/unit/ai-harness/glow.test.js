import {glowChangedBlocks, GLOW_MS} from '../../../src/lib/ai-harness/glow';

// A fake workspace faithful to the real scratch-blocks glowStack: it throws a
// BARE STRING (not an Error) on a missing/dead id, and a falsy id hits the same
// throw (the real API's `if(id)`-guarded null-deref path). getBlockById returns a
// block unless the id was registered "gone".
function fakeWorkspace (opts = {}) {
    const gone = new Set(opts.gone || []);
    const throwOnGlow = new Set(opts.throwOnGlow || []);
    const calls = [];
    return {
        calls,
        gone,
        glowStack (id, on) {
            if (!id || throwOnGlow.has(id)) throw 'Tried to glow stack on block that does not exist.';
            calls.push([id, on]);
        },
        getBlockById (id) {
            return gone.has(id) ? null : {id};
        }
    };
}

// Deterministic fake scheduler. setTimeoutFn returns a distinctive token so a test
// can assert clearTimeoutFn received exactly that handle; scheduled() counts how
// many timers were armed.
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

describe('glowChangedBlocks', () => {
    test('glows each id on, then off after the timer', () => {
        const ws = fakeWorkspace();
        const clk = fakeClock();
        glowChangedBlocks(ws, ['a', 'b'], {setTimeoutFn: clk.setTimeoutFn, clearTimeoutFn: clk.clearTimeoutFn});
        expect(ws.calls).toEqual([['a', true], ['b', true]]);
        clk.tick();
        expect(ws.calls).toEqual([['a', true], ['b', true], ['a', false], ['b', false]]);
    });

    test('no workspace → no throw, cancel is safe', () => {
        const cancel = glowChangedBlocks(null, ['a']);
        expect(typeof cancel).toBe('function');
        expect(() => cancel()).not.toThrow();
    });

    test('empty ids → nothing glows', () => {
        const ws = fakeWorkspace();
        glowChangedBlocks(ws, [], {});
        expect(ws.calls).toEqual([]);
    });

    test('a non-array topIds → no throw, nothing glows (never-throw contract)', () => {
        const ws = fakeWorkspace();
        const clk = fakeClock();
        // a number has no .length===0 and is not iterable — must be normalized away,
        // not run into the for..of.
        expect(() => glowChangedBlocks(ws, 5, {setTimeoutFn: clk.setTimeoutFn})).not.toThrow();
        expect(() => glowChangedBlocks(ws, null, {setTimeoutFn: clk.setTimeoutFn})).not.toThrow();
        expect(ws.calls).toEqual([]);
        expect(clk.scheduled()).toBe(0);
    });

    test('reducedMotion → nothing glows', () => {
        const ws = fakeWorkspace();
        glowChangedBlocks(ws, ['a'], {reducedMotion: true});
        expect(ws.calls).toEqual([]);
    });

    test('a throwing id is skipped, others still glow (fail-open)', () => {
        const ws = fakeWorkspace({throwOnGlow: ['bad']});
        const clk = fakeClock();
        glowChangedBlocks(ws, ['bad', 'good'], {setTimeoutFn: clk.setTimeoutFn, clearTimeoutFn: clk.clearTimeoutFn});
        expect(ws.calls).toEqual([['good', true]]);
        clk.tick();
        expect(ws.calls).toEqual([['good', true], ['good', false]]);
    });

    test('a falsy id (real null-deref path) is skipped, no throw', () => {
        const ws = fakeWorkspace();
        const clk = fakeClock();
        expect(() =>
            glowChangedBlocks(ws, ['', 'good'], {setTimeoutFn: clk.setTimeoutFn, clearTimeoutFn: clk.clearTimeoutFn})
        ).not.toThrow();
        expect(ws.calls).toEqual([['good', true]]);
    });

    test('when every id throws, no un-glow timer is armed', () => {
        const ws = fakeWorkspace({throwOnGlow: ['x', 'y']});
        const clk = fakeClock();
        glowChangedBlocks(ws, ['x', 'y'], {setTimeoutFn: clk.setTimeoutFn, clearTimeoutFn: clk.clearTimeoutFn});
        expect(ws.calls).toEqual([]);
        expect(clk.scheduled()).toBe(0); // glowing.length === 0 → early return, no timer
    });

    test('un-glow skips ids whose block disappeared before the timer', () => {
        const ws = fakeWorkspace({gone: ['a']});
        const clk = fakeClock();
        glowChangedBlocks(ws, ['a'], {setTimeoutFn: clk.setTimeoutFn, clearTimeoutFn: clk.clearTimeoutFn});
        expect(ws.calls).toEqual([['a', true]]); // glow ON recorded (getBlockById only gates OFF)
        clk.tick();
        expect(ws.calls).toEqual([['a', true]]); // OFF skipped because getBlockById → null
    });

    test('cancel() clears the exact stored timer handle AND un-glows so no glow is stranded', () => {
        const ws = fakeWorkspace();
        const clk = fakeClock();
        const cancel = glowChangedBlocks(ws, ['a'], {setTimeoutFn: clk.setTimeoutFn, clearTimeoutFn: clk.clearTimeoutFn});
        cancel();
        expect(clk.cleared()).toBe('timer-token'); // the exact handle setTimeoutFn returned, threaded through
        expect(ws.calls).toEqual([['a', true], ['a', false]]); // cancel turns the glow OFF, not just drops the timer
        clk.tick(); // timer already cleared → no double un-glow
        expect(ws.calls).toEqual([['a', true], ['a', false]]);
    });

    test('a custom glowMs is passed through to the scheduler', () => {
        const ws = fakeWorkspace();
        const clk = fakeClock();
        glowChangedBlocks(ws, ['a'], {glowMs: 400, setTimeoutFn: clk.setTimeoutFn, clearTimeoutFn: clk.clearTimeoutFn});
        expect(clk.lastDelay()).toBe(400);
    });

    test('exports a default glow duration', () => {
        expect(typeof GLOW_MS).toBe('number');
        expect(GLOW_MS).toBeGreaterThan(0);
    });
});
