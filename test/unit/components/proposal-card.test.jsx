import React from 'react';
import {shallowWithIntl} from '../../helpers/intl-helpers.jsx';
import {ProposalCard} from '../../../src/components/vibe-prompt/proposal-card.jsx';

const scripts = [{hat: 'when_clicked', body: [['move', 10]]}, {hat: 'when_clicked', body: [['turn', 15]]}];

test('pending: one header with Apply + Ignore, one BlockPreview per script', () => {
    const onApply = jest.fn();
    const w = shallowWithIntl(
        <ProposalCard status="pending" scripts={scripts} onApply={onApply} onIgnore={jest.fn()} onRebuild={jest.fn()} />
    );
    expect(w.find('BlockPreview')).toHaveLength(2);
    expect(w.find('.proposal-card__header')).toHaveLength(1);
    w.find('.proposal-card__apply').simulate('click');
    expect(onApply).toHaveBeenCalled();
});

test('stale: shows Rebuild, not Apply', () => {
    const w = shallowWithIntl(
        <ProposalCard status="stale" scripts={scripts} onApply={jest.fn()} onIgnore={jest.fn()} onRebuild={jest.fn()} />
    );
    expect(w.find('.proposal-card__rebuild')).toHaveLength(1);
    expect(w.find('.proposal-card__apply')).toHaveLength(0);
});

test('applied: shows the applied label, no action buttons', () => {
    const w = shallowWithIntl(
        <ProposalCard status="applied" scripts={scripts} onApply={jest.fn()} onIgnore={jest.fn()} onRebuild={jest.fn()} />
    );
    expect(w.find('.proposal-card__applied')).toHaveLength(1);
    expect(w.find('.proposal-card__apply')).toHaveLength(0);
    expect(w.find('.proposal-card__rebuild')).toHaveLength(0);
});
