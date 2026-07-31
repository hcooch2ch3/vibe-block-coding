import {scriptToXml} from '../../../src/lib/ai-harness/dsl-to-blockly-xml';

describe('scriptToXml', () => {
    test('renders a hat with a chained body (move, turn)', () => {
        const xml = scriptToXml({hat: 'when_flag', body: [['move', 10], ['turn', 15]]});
        expect(xml).toMatch(/^<xml[^>]*>/);
        expect(xml).toContain('type="event_whenflagclicked"');
        expect(xml).toContain('type="motion_movesteps"');
        expect(xml).toContain('type="motion_turnright"');
        expect(xml).toContain('<value name="STEPS"><shadow type="math_number"><field name="NUM">10</field></shadow></value>');
        expect(xml).toContain('<next>');
    });

    test('renders a two-input block (say_secs: MESSAGE text + SECS number)', () => {
        const xml = scriptToXml({hat: 'when_flag', body: [['say_secs', 'hi', 2]]});
        expect(xml).toContain('type="looks_sayforsecs"');
        expect(xml).toContain('<value name="MESSAGE"><shadow type="text"><field name="TEXT">hi</field></shadow></value>');
        expect(xml).toContain('<value name="SECS"><shadow type="math_number"><field name="NUM">2</field></shadow></value>');
    });

    test('renders repeat with a SUBSTACK statement', () => {
        const xml = scriptToXml({hat: 'when_flag', body: [['repeat', 3, [['move', 10]]]]});
        expect(xml).toContain('type="control_repeat"');
        expect(xml).toContain('<value name="TIMES"><shadow type="math_whole_number"><field name="NUM">3</field></shadow></value>');
        expect(xml).toContain('<statement name="SUBSTACK">');
        const stmt = xml.slice(xml.indexOf('<statement name="SUBSTACK">'));
        expect(stmt).toContain('type="motion_movesteps"');
    });

    test('forever is a cap block — no trailing <next> after it', () => {
        const xml = scriptToXml({hat: 'when_flag', body: [['forever', [['turn', 15]]]]});
        expect(xml).toContain('type="control_forever"');
        const after = xml.slice(xml.indexOf('type="control_forever"'));
        expect(after).toContain('<statement name="SUBSTACK">');
        expect(after).not.toMatch(/<\/block><next>/);
    });

    test('omits the statement when a substack body is empty', () => {
        const xml = scriptToXml({hat: 'when_flag', body: [['repeat', 3, []]]});
        expect(xml).toContain('type="control_repeat"');
        expect(xml).not.toContain('<statement');
    });

    test('escapes XML-special characters in text fields', () => {
        const xml = scriptToXml({hat: 'when_flag', body: [['say', 'a<b & c">']]});
        expect(xml).toContain('a&lt;b &amp; c&quot;&gt;');
        expect(xml).not.toContain('a<b & c">');
    });

    test('skips an unknown op but still renders the rest of the chain', () => {
        const xml = scriptToXml({hat: 'when_flag', body: [['bogus', 1], ['move', 10]]});
        expect(xml).not.toContain('bogus');
        expect(xml).toContain('type="motion_movesteps"');
    });
});
