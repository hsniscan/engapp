import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  buildWidgetState,
  meaningOf,
  parseWidgetState,
  pickWordOfDay,
  sameWidgetContent,
  WIDGET_STATE_VERSION,
  type WordCandidate,
} from './widget';

const word = (
  note_id: string,
  stage: WordCandidate['stage'] = 'learning',
  tr = `tr-${note_id}`,
): WordCandidate => ({
  note_id,
  term: `en-${note_id}`,
  stage,
  senses: [{ sense_no: 1, meaning_tr: tr, meaning_tr_override: null }],
});

const pool = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => word(id));

describe('pickWordOfDay', () => {
  it('is the same word all day, whatever the order of the candidates', () => {
    const a = pickWordOfDay(pool, '2026-10-26');
    const b = pickWordOfDay([...pool].reverse(), '2026-10-26');
    expect(a).not.toBeNull();
    expect(b?.note_id).toBe(a?.note_id);
  });

  it('changes from day to day (not always the same word)', () => {
    const days = Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`);
    const picked = new Set(days.map((d) => pickWordOfDay(pool, d)?.note_id));
    expect(picked.size).toBeGreaterThan(3);
  });

  it('takes only words being learned (Öğreniyor, Pekişiyor) with a meaning', () => {
    const only = [
      word('new', 'new'),
      word('learned', 'learned'),
      word('mastered', 'mastered'),
      word('empty', 'learning', '  '),
      word('ok', 'consolidating'),
    ];
    for (let d = 1; d <= 20; d++)
      expect(pickWordOfDay(only, `2026-12-${String(d).padStart(2, '0')}`)?.note_id).toBe('ok');
    expect(pickWordOfDay([word('n', 'new')], '2026-10-26')).toBeNull();
    expect(pickWordOfDay([], '2026-10-26')).toBeNull();
  });

  it('keeps the word when other words join or leave the set (rendezvous)', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 6 }), { minLength: 1, maxLength: 12 }),
        (extra) => {
          const day = '2026-10-26';
          const base = pickWordOfDay(pool, day)!;
          const more = [
            ...pool,
            ...extra.filter((id) => !pool.some((p) => p.note_id === id)).map((id) => word(id)),
          ];
          const picked = pickWordOfDay(more, day)!;
          // A newcomer may win, but no other old word can take the place of the picked one.
          return picked.note_id === base.note_id || !pool.some((p) => p.note_id === picked.note_id);
        },
      ),
    );
  });

  it('keeps today’s word after it moves to Öğrenildi, not on another day', () => {
    const day = '2026-10-26';
    const first = pickWordOfDay(pool, day)!;
    const moved = pool.map((w) =>
      w.note_id === first.note_id ? { ...w, stage: 'learned' as const } : w,
    );
    expect(pickWordOfDay(moved, day, { day, note_id: first.note_id })?.note_id).toBe(first.note_id);
    expect(pickWordOfDay(moved, day)?.note_id).not.toBe(first.note_id);
    expect(pickWordOfDay(moved, '2026-10-27', { day, note_id: first.note_id })?.note_id).toBe(
      pickWordOfDay(moved, '2026-10-27')?.note_id,
    );
  });
});

describe('meaningOf', () => {
  it('lists the first two senses in order, the correction winning, without repeats', () => {
    expect(
      meaningOf([
        { sense_no: 2, meaning_tr: 'kıyı', meaning_tr_override: null },
        { sense_no: 1, meaning_tr: 'banka', meaning_tr_override: ' banka şubesi ' },
        { sense_no: 3, meaning_tr: 'yığın', meaning_tr_override: null },
      ]),
    ).toBe('banka şubesi; kıyı');
    expect(
      meaningOf([
        { sense_no: 1, meaning_tr: 'aynı', meaning_tr_override: null },
        { sense_no: 2, meaning_tr: 'aynı', meaning_tr_override: null },
      ]),
    ).toBe('aynı');
  });

  it('cuts a long meaning with an ellipsis', () => {
    const m = meaningOf([{ sense_no: 1, meaning_tr: 'ç'.repeat(200), meaning_tr_override: null }]);
    expect([...m]).toHaveLength(80);
    expect(m.endsWith('…')).toBe(true);
  });
});

describe('buildWidgetState', () => {
  const today = { day: '2026-10-26', due: 12, new_count: 5, day_end: 1_000 };
  const tomorrow = { day: '2026-10-27', due: 20, new_count: 10, day_end: 2_000 };

  it('writes the counts, today’s and tomorrow’s word and the write time', () => {
    const s = buildWidgetState({ today, tomorrow, candidates: pool, previous: null, now: 500 });
    expect(s).toMatchObject({
      v: WIDGET_STATE_VERSION,
      day: '2026-10-26',
      due: 12,
      new_count: 5,
      day_end: 1_000,
      updated_at: 500,
    });
    const w = pickWordOfDay(pool, '2026-10-26')!;
    expect(s.word).toEqual({ tr: `tr-${w.note_id}`, en: `en-${w.note_id}`, note_id: w.note_id });
    expect(s.next).toMatchObject({ day: '2026-10-27', due: 20, new_count: 10, day_end: 2_000 });
    expect(s.next?.word?.note_id).toBe(pickWordOfDay(pool, '2026-10-27')?.note_id);
  });

  it('has no word when nothing is being learned, and never a negative count', () => {
    const s = buildWidgetState({
      today: { ...today, due: -3, new_count: Number.NaN },
      tomorrow: null,
      candidates: [word('x', 'new')],
      previous: null,
      now: 1,
    });
    expect(s.word).toBeNull();
    expect(s.due).toBe(0);
    expect(s.new_count).toBe(0);
    expect(s.next).toBeNull();
  });

  it('keeps the word of the previous state on the same day', () => {
    const first = buildWidgetState({ today, tomorrow, candidates: pool, previous: null, now: 1 });
    const rest = pool.filter((w) => w.note_id !== first.word!.note_id);
    const kept = {
      ...pool.find((w) => w.note_id === first.word!.note_id)!,
      stage: 'learned' as const,
    };
    const again = buildWidgetState({
      today,
      tomorrow,
      candidates: [...rest, kept],
      previous: first,
      now: 2,
    });
    expect(again.word).toEqual(first.word);
  });

  it('round-trips through JSON and tells when only the time changed', () => {
    const a = buildWidgetState({ today, tomorrow, candidates: pool, previous: null, now: 1 });
    const b = buildWidgetState({ today, tomorrow, candidates: pool, previous: null, now: 2 });
    expect(parseWidgetState(JSON.stringify(a))).toEqual(a);
    expect(sameWidgetContent(a, b)).toBe(true);
    expect(sameWidgetContent(a, { ...b, due: 3 })).toBe(false);
    expect(sameWidgetContent(null, b)).toBe(false);
    expect(parseWidgetState('{"v":99,"day":"x"}')).toBeNull();
    expect(parseWidgetState('not json')).toBeNull();
    expect(parseWidgetState(null)).toBeNull();
  });
});
