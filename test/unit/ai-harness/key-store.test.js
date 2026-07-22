import {loadKey, saveKey, clearKey, STORAGE_KEY} from '../../../src/lib/ai-harness/key-store';

const makeStorage = () => {
    const map = {};
    return {
        getItem: k => (k in map ? map[k] : null),
        setItem: (k, v) => {
            map[k] = String(v);
        },
        removeItem: k => {
            delete map[k];
        }
    };
};

describe('key-store', () => {
    test('loadKey returns empty string when nothing saved', () => {
        expect(loadKey(makeStorage())).toBe('');
    });
    test('saveKey then loadKey round-trips a trimmed key and returns true', () => {
        const s = makeStorage();
        expect(saveKey('  sk-ant-123  ', s)).toBe(true);
        expect(loadKey(s)).toBe('sk-ant-123');
        expect(s.getItem(STORAGE_KEY)).toBe('sk-ant-123');
    });
    test('saveKey with blank removes the stored key (not stored as empty)', () => {
        const s = makeStorage();
        saveKey('sk-ant-123', s);
        expect(saveKey('   ', s)).toBe(true);
        expect(loadKey(s)).toBe('');
        expect(s.getItem(STORAGE_KEY)).toBeNull();
    });
    test('saveKey with null/undefined clears the stored key', () => {
        const s = makeStorage();
        saveKey('sk-ant-123', s);
        expect(saveKey(null, s)).toBe(true);
        expect(loadKey(s)).toBe('');
        saveKey('sk-ant-456', s);
        expect(saveKey(undefined, s)).toBe(true);
        expect(loadKey(s)).toBe('');
    });
    test('clearKey removes the key', () => {
        const s = makeStorage();
        saveKey('sk-ant-123', s);
        clearKey(s);
        expect(loadKey(s)).toBe('');
    });
    test('loadKey swallows storage errors and returns empty', () => {
        const bad = {getItem: () => {
            throw new Error('blocked');
        }};
        expect(loadKey(bad)).toBe('');
    });
    test('saveKey returns false and clearKey swallows storage errors (private mode / quota)', () => {
        const bad = {
            setItem: () => {
                throw new Error('blocked');
            },
            removeItem: () => {
                throw new Error('blocked');
            }
        };
        expect(saveKey('sk-ant-123', bad)).toBe(false);
        expect(() => clearKey(bad)).not.toThrow();
    });
    test('null storage (SSR / no window) degrades safely', () => {
        expect(loadKey(null)).toBe('');
        expect(saveKey('sk-ant-123', null)).toBe(false);
        expect(() => clearKey(null)).not.toThrow();
    });
});
