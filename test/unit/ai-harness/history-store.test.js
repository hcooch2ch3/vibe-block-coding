import {loadHistory, saveHistory, STORAGE_KEY, MAX_ENTRIES} from '../../../src/lib/ai-harness/history-store';

const makeStorage = initial => {
    const map = new Map(Object.entries(initial || {}));
    return {
        getItem: k => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => {
            map.set(k, String(v));
        },
        removeItem: k => {
            map.delete(k);
        }
    };
};

const entry = id => ({id, instruction: `i${id}`, changes: [], status: 'done'});

describe('history-store', () => {
    test('returns [] when nothing stored', () => {
        expect(loadHistory(makeStorage())).toEqual([]);
    });
    test('round-trips a saved history', () => {
        const storage = makeStorage();
        saveHistory([entry(0), entry(1)], storage);
        expect(loadHistory(storage)).toEqual([entry(0), entry(1)]);
    });
    test('returns [] on malformed JSON', () => {
        expect(loadHistory(makeStorage({[STORAGE_KEY]: '{bad'}))).toEqual([]);
    });
    test('returns [] when the stored value is not an array', () => {
        expect(loadHistory(makeStorage({[STORAGE_KEY]: '{"x":1}'}))).toEqual([]);
    });
    test('returns [] when storage is unavailable', () => {
        expect(loadHistory(null)).toEqual([]);
    });
    test('trims to the last MAX_ENTRIES on save', () => {
        const storage = makeStorage();
        const many = Array.from({length: MAX_ENTRIES + 5}, (_, i) => entry(i));
        saveHistory(many, storage);
        const loaded = loadHistory(storage);
        expect(loaded).toHaveLength(MAX_ENTRIES);
        expect(loaded[0].id).toBe(5);
        expect(loaded[loaded.length - 1].id).toBe(MAX_ENTRIES + 4);
    });
    test('returns true on success, false when storage throws or is unavailable', () => {
        expect(saveHistory([entry(0)], makeStorage())).toBe(true);
        const throwing = {setItem: () => {
            throw new Error('quota');
        }};
        expect(saveHistory([entry(0)], throwing)).toBe(false);
        expect(saveHistory([entry(0)], null)).toBe(false);
    });
});
