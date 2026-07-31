import {
    loadPrefs, savePrefs, clampPosition, defaultPosition, clampSize,
    STORAGE_KEY, CARD_WIDTH, HEADER_H, EDGE_MARGIN, MENU_BAR_TOP, MIN_W, MIN_H
} from '../../../src/lib/ai-harness/ui-prefs';

const makeStorage = initial => {
    const map = new Map(Object.entries(initial || {}));
    return {
        getItem: k => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => {
            map.set(k, String(v));
        },
        removeItem: k => {
            map.delete(k);
        },
        _map: map
    };
};

describe('ui-prefs', () => {
    describe('loadPrefs', () => {
        test('returns null when nothing stored', () => {
            expect(loadPrefs(makeStorage())).toBe(null);
        });
        test('round-trips a saved prefs object (size defaults to null)', () => {
            const storage = makeStorage();
            savePrefs({x: 12, y: 34, collapsed: true}, storage);
            expect(loadPrefs(storage)).toEqual({x: 12, y: 34, collapsed: true, w: null, h: null});
        });
        test('round-trips a saved size', () => {
            const storage = makeStorage();
            savePrefs({x: 1, y: 2, collapsed: false, w: 360, h: 300}, storage);
            const loaded = loadPrefs(storage);
            expect(loaded.w).toBe(360);
            expect(loaded.h).toBe(300);
        });
        test('returns null on malformed JSON', () => {
            const storage = makeStorage({[STORAGE_KEY]: '{not json'});
            expect(loadPrefs(storage)).toBe(null);
        });
        test('returns null when x/y are not finite numbers', () => {
            const storage = makeStorage({[STORAGE_KEY]: JSON.stringify({x: 'a', y: 1, collapsed: false})});
            expect(loadPrefs(storage)).toBe(null);
        });
        test('returns null when storage is unavailable', () => {
            expect(loadPrefs(null)).toBe(null);
        });
    });

    describe('savePrefs', () => {
        test('returns true on success', () => {
            expect(savePrefs({x: 1, y: 2, collapsed: false}, makeStorage())).toBe(true);
        });
        test('coerces collapsed to a boolean', () => {
            const storage = makeStorage();
            savePrefs({x: 1, y: 2, collapsed: 1}, storage);
            expect(loadPrefs(storage).collapsed).toBe(true);
        });
        test('returns false when storage throws', () => {
            const throwing = {setItem: () => {
                throw new Error('quota');
            }};
            expect(savePrefs({x: 1, y: 2, collapsed: false}, throwing)).toBe(false);
        });
        test('returns false when storage is unavailable', () => {
            expect(savePrefs({x: 1, y: 2, collapsed: false}, null)).toBe(false);
        });
    });

    describe('clampPosition', () => {
        const vp = {innerWidth: 1000, innerHeight: 800};
        test('leaves an in-bounds position unchanged', () => {
            expect(clampPosition({x: 500, y: 400}, vp)).toEqual({x: 500, y: 400});
        });
        test('pulls a far off-screen position back in-range', () => {
            expect(clampPosition({x: 99999, y: 99999}, vp)).toEqual({
                x: vp.innerWidth - CARD_WIDTH - EDGE_MARGIN,
                y: vp.innerHeight - HEADER_H - EDGE_MARGIN
            });
        });
        test('clamps negative coords to the edge margin (y stays below the menu bar)', () => {
            expect(clampPosition({x: -500, y: -500}, vp)).toEqual({x: EDGE_MARGIN, y: MENU_BAR_TOP});
        });
        test('honors a taller cardHeight so the expanded body stays on-screen', () => {
            const tall = 220;
            expect(clampPosition({x: 500, y: 99999}, vp, tall).y).toBe(vp.innerHeight - tall - EDGE_MARGIN);
        });
    });

    describe('clampSize', () => {
        const vp = {innerWidth: 1000, innerHeight: 800};
        test('leaves an in-bounds size unchanged', () => {
            expect(clampSize({w: 360, h: 300}, vp)).toEqual({w: 360, h: 300});
        });
        test('clamps below the minimum up to MIN_W/MIN_H', () => {
            expect(clampSize({w: 10, h: 10}, vp)).toEqual({w: MIN_W, h: MIN_H});
        });
        test('clamps above the viewport down to fit', () => {
            const clamped = clampSize({w: 99999, h: 99999}, vp);
            expect(clamped.w).toBeLessThanOrEqual(vp.innerWidth);
            expect(clamped.h).toBeLessThan(vp.innerHeight);
        });
    });

    describe('defaultPosition', () => {
        test('anchors bottom-right within bounds', () => {
            const vp = {innerWidth: 1000, innerHeight: 800};
            const pos = defaultPosition(vp);
            expect(pos.x).toBe(vp.innerWidth - CARD_WIDTH - EDGE_MARGIN);
            expect(pos.y).toBeLessThanOrEqual(vp.innerHeight - HEADER_H - EDGE_MARGIN);
            expect(pos.x).toBeGreaterThanOrEqual(EDGE_MARGIN);
            expect(pos.y).toBeGreaterThanOrEqual(EDGE_MARGIN);
        });
    });
});
