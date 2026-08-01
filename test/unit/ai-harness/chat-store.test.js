import {loadChat, saveChat, STORAGE_KEY} from '../../../src/lib/ai-harness/chat-store';

const mem = () => {
    const m = {};
    return {
        getItem: k => (k in m ? m[k] : null),
        setItem: (k, v) => { m[k] = v; }
    };
};

test('round-trips turns under the v2 key', () => {
    const s = mem();
    const turns = [
        {id: 0, role: 'user', text: 'walk'},
        {id: 1, role: 'ai', kind: 'answer', text: 'ok', instruction: 'walk', targetId: 't1'}
    ];
    expect(saveChat(turns, s)).toBe(true);
    expect(s.getItem(STORAGE_KEY)).toEqual(expect.any(String));
    expect(loadChat(s)).toEqual(turns);
});

test('loadChat drops shape-invalid entries (no role)', () => {
    const s = mem();
    s.setItem(STORAGE_KEY, JSON.stringify([{id: 0, role: 'user', text: 'hi'}, {garbage: true}]));
    expect(loadChat(s)).toEqual([{id: 0, role: 'user', text: 'hi'}]);
});

test('loadChat returns [] for a non-array blob', () => {
    const s = mem();
    s.setItem(STORAGE_KEY, JSON.stringify({not: 'array'}));
    expect(loadChat(s)).toEqual([]);
});

test('saveChat strips preview/baseStamp from terminal turns, keeps them for pending', () => {
    const s = mem();
    const vol = {preview: {k: 1}, baseStamp: {targetId: 'x', baseHash: 'h'}};
    const turns = [
        {id: 0, role: 'ai', kind: 'proposal', text: 't', instruction: 'i', targetId: 'x', status: 'applied', preview: vol.preview, baseStamp: vol.baseStamp},
        {id: 1, role: 'ai', kind: 'proposal', text: 't', instruction: 'i', targetId: 'x', status: 'pending', preview: vol.preview, baseStamp: vol.baseStamp}
    ];
    saveChat(turns, s);
    const loaded = JSON.parse(s.getItem(STORAGE_KEY));
    expect(loaded[0].preview).toBeUndefined();
    expect(loaded[0].baseStamp).toBeUndefined();
    expect(loaded[1].preview).toEqual({k: 1});
    expect(loaded[1].baseStamp).toEqual({targetId: 'x', baseHash: 'h'});
});
