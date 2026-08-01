import React from 'react';
import {shallowWithIntl} from '../../helpers/intl-helpers.jsx';
import {HistoryRow} from '../../../src/components/vibe-prompt/history-row.jsx';
import ProposalCard from '../../../src/components/vibe-prompt/proposal-card.jsx';

test('answer turn renders a Make-it button that calls onMakeIt with the turn', () => {
    const turn = {id: 3, role: 'ai', kind: 'answer', text: 'Use move!', instruction: 'jump', targetId: 't1'};
    const onMakeIt = jest.fn();
    const w = shallowWithIntl(
        <HistoryRow turn={turn} onMakeIt={onMakeIt} onApply={jest.fn()} onIgnore={jest.fn()} onRebuild={jest.fn()} />
    );
    w.find('.vibe-makeit').simulate('click');
    expect(onMakeIt).toHaveBeenCalledWith(turn);
});

test('user turn renders a plain bubble, no card', () => {
    const w = shallowWithIntl(
        <HistoryRow turn={{id: 1, role: 'user', text: 'walk'}}
            onMakeIt={jest.fn()} onApply={jest.fn()} onIgnore={jest.fn()} onRebuild={jest.fn()} />
    );
    expect(w.find(ProposalCard)).toHaveLength(0);
    expect(w.find('.vibe-bubble--user')).toHaveLength(1);
});

test('terminal proposal with no preview does not crash', () => {
    const turn = {id: 6, role: 'ai', kind: 'proposal', status: 'applied', text: 'Moved'};
    expect(() => shallowWithIntl(
        <HistoryRow turn={turn} onApply={jest.fn()} onIgnore={jest.fn()} onRebuild={jest.fn()} onMakeIt={jest.fn()} />
    )).not.toThrow();
});

test('edit-kind proposal previews a changed script as updated, not the whole program', () => {
    const turn = {
        id: 7, role: 'ai', kind: 'proposal', status: 'pending', text: 'Moved sprite',
        preview: {
            kind: 'edit',
            oldScripts: [{hat: 'when_flag', body: [['wait', 1]]}],
            newScripts: [{hat: 'when_flag', body: [['move', 5]]}],
            baseStamp: {targetId: 't1', baseHash: 'H2'}
        }
    };
    const w = shallowWithIntl(
        <HistoryRow turn={turn} onApply={jest.fn()} onIgnore={jest.fn()} onRebuild={jest.fn()} onMakeIt={jest.fn()} />
    );
    const card = w.find(ProposalCard);
    expect(card).toHaveLength(1);
    // the one script changed in place → previewed as 'updated'
    expect(card.prop('previews')).toEqual([
        {script: {hat: 'when_flag', body: [['move', 5]]}, variant: 'updated'}
    ]);
});

test('edit-kind proposal previews ONLY the added script, not the kept one (regression)', () => {
    // Repro of the reported bug: "say hello" was already applied, then "walk around"
    // is proposed. edit sends the current program and gets it back WITH the unchanged
    // say-hello script still in newScripts. The card must preview only the new stack.
    const sayHello = {hat: 'when_this_sprite_clicked', body: [['say', 'hello']]};
    const walk = {hat: 'when_flag', body: [['forever', [['move', 10], ['turn_right', 15]]]]};
    const turn = {
        id: 8, role: 'ai', kind: 'proposal', status: 'pending', text: 'Now it walks',
        preview: {
            kind: 'edit',
            oldScripts: [sayHello],
            newScripts: [sayHello, walk],
            baseStamp: {targetId: 't1', baseHash: 'H3'}
        }
    };
    const w = shallowWithIntl(
        <HistoryRow turn={turn} onApply={jest.fn()} onIgnore={jest.fn()} onRebuild={jest.fn()} onMakeIt={jest.fn()} />
    );
    const previews = w.find(ProposalCard).prop('previews');
    expect(previews).toEqual([{script: walk, variant: 'added'}]);
});

test('proposal turn renders a ProposalCard fed from the preview adapter', () => {
    const turn = {id: 5, role: 'ai', kind: 'proposal', text: 'Added a move', status: 'pending',
        instruction: 'walk', targetId: 't1',
        preview: {kind: 'generate', blocks: [{hat: 'when_clicked', body: [['move', 10]]}], baseStamp: {targetId: 't1', baseHash: 'H'}}};
    const onApply = jest.fn();
    const w = shallowWithIntl(
        <HistoryRow turn={turn} onApply={onApply} onIgnore={jest.fn()} onRebuild={jest.fn()} onMakeIt={jest.fn()} />
    );
    const card = w.find(ProposalCard);
    expect(card).toHaveLength(1);
    expect(card.prop('status')).toBe('pending');
    expect(card.prop('previews')).toEqual([
        {script: {hat: 'when_clicked', body: [['move', 10]]}, variant: 'added'}
    ]);
    expect(card.prop('explanation')).toBe('Added a move');
    // the row's bound handler forwards the turn
    card.prop('onApply')();
    expect(onApply).toHaveBeenCalledWith(turn);
});
