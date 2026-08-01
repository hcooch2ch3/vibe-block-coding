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

test('edit-kind proposal turn passes newScripts as scripts to ProposalCard', () => {
    const newScripts = [{hat: 'when_flag', body: [['move', 5]]}];
    const turn = {
        id: 7, role: 'ai', kind: 'proposal', status: 'pending', text: 'Moved sprite',
        preview: {
            kind: 'edit',
            oldScripts: [{hat: 'when_flag', body: [['wait', 1]]}],
            newScripts: newScripts,
            baseStamp: {targetId: 't1', baseHash: 'H2'}
        }
    };
    const w = shallowWithIntl(
        <HistoryRow turn={turn} onApply={jest.fn()} onIgnore={jest.fn()} onRebuild={jest.fn()} onMakeIt={jest.fn()} />
    );
    const card = w.find(ProposalCard);
    expect(card).toHaveLength(1);
    expect(card.prop('scripts')).toEqual(newScripts);
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
    expect(card.prop('scripts')).toEqual([{hat: 'when_clicked', body: [['move', 10]]}]);
    expect(card.prop('explanation')).toBe('Added a move');
    // the row's bound handler forwards the turn
    card.prop('onApply')();
    expect(onApply).toHaveBeenCalledWith(turn);
});
