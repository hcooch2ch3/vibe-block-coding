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

test('a replace op previews as updated', () => {
    const turn = {
        id: 7, role: 'ai', kind: 'proposal', status: 'pending', text: 'Moved sprite',
        preview: {
            kind: 'edit',
            ops: [{type: 'replace', index: 0, script: {hat: 'when_flag', body: [['move', 5]]}}],
            baseStamp: {targetId: 't1', baseHash: 'H2'}
        }
    };
    const w = shallowWithIntl(
        <HistoryRow turn={turn} onApply={jest.fn()} onIgnore={jest.fn()} onRebuild={jest.fn()} onMakeIt={jest.fn()} />
    );
    const card = w.find(ProposalCard);
    expect(card).toHaveLength(1);
    expect(card.prop('previews')).toEqual([
        {script: {hat: 'when_flag', body: [['move', 5]]}, variant: 'updated'}
    ]);
});

test('an add op previews as added; kept scripts (no op) never re-appear', () => {
    // The reported bug: "say hello" already applied, then "walk around" proposed.
    // The proposal now carries ONLY the add op for walk — the kept say-hello has no op.
    const walk = {hat: 'when_flag', body: [['forever', [['move', 10], ['turn_right', 15]]]]};
    const turn = {
        id: 8, role: 'ai', kind: 'proposal', status: 'pending', text: 'Now it walks',
        preview: {kind: 'edit', ops: [{type: 'add', index: null, script: walk}], baseStamp: {targetId: 't1', baseHash: 'H3'}}
    };
    const w = shallowWithIntl(
        <HistoryRow turn={turn} onApply={jest.fn()} onIgnore={jest.fn()} onRebuild={jest.fn()} onMakeIt={jest.fn()} />
    );
    expect(w.find(ProposalCard).prop('previews')).toEqual([{script: walk, variant: 'added'}]);
});

test('a remove op previews nothing but sets removeCount for the warning', () => {
    const turn = {
        id: 9, role: 'ai', kind: 'proposal', status: 'pending', text: 'Removed spin',
        preview: {kind: 'edit', ops: [{type: 'remove', index: 1}], baseStamp: {targetId: 't1', baseHash: 'H4'}}
    };
    const w = shallowWithIntl(
        <HistoryRow turn={turn} onApply={jest.fn()} onIgnore={jest.fn()} onRebuild={jest.fn()} onMakeIt={jest.fn()} />
    );
    const card = w.find(ProposalCard);
    expect(card.prop('previews')).toEqual([]);
    expect(card.prop('removeCount')).toBe(1);
});

test('proposal turn renders a ProposalCard fed from the ops adapter', () => {
    const turn = {id: 5, role: 'ai', kind: 'proposal', text: 'Added a move', status: 'pending',
        instruction: 'walk', targetId: 't1',
        preview: {kind: 'edit', ops: [{type: 'add', index: null, script: {hat: 'when_clicked', body: [['move', 10]]}}],
            baseStamp: {targetId: 't1', baseHash: 'H'}}};
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
    expect(card.prop('removeCount')).toBe(0);
    expect(card.prop('explanation')).toBe('Added a move');
    // the row's bound handler forwards the turn
    card.prop('onApply')();
    expect(onApply).toHaveBeenCalledWith(turn);
});
