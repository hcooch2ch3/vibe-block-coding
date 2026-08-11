import fs from 'fs';
import path from 'path';
import vibeMessages from '../../../src/lib/ai-harness/vibe-l10n';

// Source files that declare `vibe.*` message ids via defineMessages().
const SRC_FILES = [
    'src/components/vibe-prompt/vibe-prompt.jsx',
    'src/components/vibe-prompt/proposal-card.jsx',
    'src/components/vibe-prompt/history-list.jsx',
    'src/components/vibe-prompt/history-row.jsx',
    'src/components/vibe-prompt/memory-slider.jsx',
    'src/containers/vibe-prompt.jsx'
];

const collectIds = () => {
    const ids = new Set();
    const re = /id:\s*'(vibe\.[a-zA-Z.]+)'/g;
    for (const rel of SRC_FILES) {
        const src = fs.readFileSync(path.resolve(__dirname, '../../../', rel), 'utf8');
        let m;
        while ((m = re.exec(src)) !== null) ids.add(m[1]);
    }
    return ids;
};

describe('vibe-l10n Korean translations', () => {
    const usedIds = collectIds();
    const ko = vibeMessages.ko;

    test('exports a ko message map', () => {
        expect(ko && typeof ko === 'object').toBe(true);
        expect(Object.keys(ko).length).toBeGreaterThan(0);
    });

    test('every vibe.* id used in the panel has a non-empty ko translation', () => {
        const missing = [...usedIds].filter(id => !ko[id] || !ko[id].trim());
        expect(missing).toEqual([]);
    });

    test('no stale ko keys that are not used anywhere (catches typos)', () => {
        const stale = Object.keys(ko).filter(id => !usedIds.has(id));
        expect(stale).toEqual([]);
    });

    test('ICU placeholder {count} is preserved in the removes message', () => {
        expect(ko['vibe.proposal.removes']).toMatch(/\{count\}/);
    });
});
