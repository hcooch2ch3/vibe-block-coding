import React from 'react';
import {shallowWithIntl} from '../../helpers/intl-helpers.jsx';
import {ProposalCard} from '../../../src/components/vibe-prompt/proposal-card.jsx';

const previews = [
    {script: {hat: 'when_clicked', body: [['move', 10]]}, variant: 'added'},
    {script: {hat: 'when_clicked', body: [['turn', 15]]}, variant: 'updated'}
];

test('pending: one header with Apply + Ignore, one BlockPreview per script', () => {
    const onApply = jest.fn();
    const onIgnore = jest.fn();
    const w = shallowWithIntl(
        <ProposalCard status="pending" previews={previews} onApply={onApply} onIgnore={onIgnore} onRebuild={jest.fn()} />
    );
    expect(w.find('BlockPreview')).toHaveLength(2);
    expect(w.find('.proposal-card__header')).toHaveLength(1);
    w.find('.proposal-card__apply').simulate('click');
    expect(onApply).toHaveBeenCalled();
    w.find('.proposal-card__ignore').simulate('click');
    expect(onIgnore).toHaveBeenCalled();
});

test('stale: shows Rebuild, not Apply; fires onRebuild; shows stale label', () => {
    const onRebuild = jest.fn();
    const w = shallowWithIntl(
        <ProposalCard status="stale" previews={previews} onApply={jest.fn()} onIgnore={jest.fn()} onRebuild={onRebuild} />
    );
    expect(w.find('.proposal-card__rebuild')).toHaveLength(1);
    expect(w.find('.proposal-card__apply')).toHaveLength(0);
    expect(w.find('.proposal-card__stale-label')).toHaveLength(1);
    w.find('.proposal-card__rebuild').simulate('click');
    expect(onRebuild).toHaveBeenCalled();
});

test('applied: shows the applied label, no action buttons', () => {
    const w = shallowWithIntl(
        <ProposalCard status="applied" previews={previews} onApply={jest.fn()} onIgnore={jest.fn()} onRebuild={jest.fn()} />
    );
    expect(w.find('.proposal-card__applied')).toHaveLength(1);
    expect(w.find('.proposal-card__apply')).toHaveLength(0);
    expect(w.find('.proposal-card__rebuild')).toHaveLength(0);
});

test('applied status renders no BlockPreview', () => {
    const w = shallowWithIntl(
        <ProposalCard status="applied" previews={previews} onApply={jest.fn()} onIgnore={jest.fn()} onRebuild={jest.fn()} />
    );
    expect(w.find('BlockPreview')).toHaveLength(0);
    expect(w.find('.proposal-card__applied')).toHaveLength(1);
});

test('ignored: shows ignored label, no apply or rebuild', () => {
    const w = shallowWithIntl(
        <ProposalCard status="ignored" previews={previews} onApply={jest.fn()} onIgnore={jest.fn()} onRebuild={jest.fn()} />
    );
    expect(w.find('.proposal-card__ignored')).toHaveLength(1);
    expect(w.find('.proposal-card__apply')).toHaveLength(0);
    expect(w.find('.proposal-card__rebuild')).toHaveLength(0);
});

test('pending with removeCount renders the pluralized removal warning (ICU render)', () => {
    const w = shallowWithIntl(
        <ProposalCard status="pending" previews={[]} removeCount={2}
            onApply={jest.fn()} onIgnore={jest.fn()} onRebuild={jest.fn()} />
    );
    const warn = w.find('.proposal-card__removes');
    expect(warn).toHaveLength(1);
    expect(warn.text()).toContain('2 block stacks');
});

test('removeCount 0 shows no removal warning', () => {
    const w = shallowWithIntl(
        <ProposalCard status="pending" previews={previews} removeCount={0}
            onApply={jest.fn()} onIgnore={jest.fn()} onRebuild={jest.fn()} />
    );
    expect(w.find('.proposal-card__removes')).toHaveLength(0);
});
