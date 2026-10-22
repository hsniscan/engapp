// @vitest-environment node
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { autoPriority, inOwnerBand, type PriorityInput } from './image-priority.ts';
import type { Cefr } from './cefr.ts';

const base: PriorityInput = {
  inAdminCards: false,
  users: 0,
  cefr: null,
  ownerLevels: ['B1'],
  zipf: null,
  inTop: false,
};

describe('bulk picture priority (İP9)', () => {
  // The same numbers as supabase/tests/database/31_image_priority.test.sql.
  it('matches the SQL formula', () => {
    expect(autoPriority({ ...base, inAdminCards: true, users: 2 })).toBe(2002);
    expect(autoPriority({ ...base, users: 3, cefr: 'B2', zipf: 5, inTop: true })).toBe(1003);
    expect(autoPriority({ ...base, cefr: 'B2', zipf: 5.04, inTop: true })).toBe(550);
    expect(autoPriority({ ...base, cefr: 'C2', zipf: 6.26, inTop: true })).toBe(163);
    expect(autoPriority({ ...base, inTop: true })).toBe(100);
    expect(autoPriority({ ...base, cefr: 'C2', zipf: 2 })).toBeNull();
  });

  it('owner band is the owner level ±1; unknown levels are outside', () => {
    expect(inOwnerBand('A2', ['B1'])).toBe(true);
    expect(inOwnerBand('B2', ['B1'])).toBe(true);
    expect(inOwnerBand('C1', ['B1'])).toBe(false);
    expect(inOwnerBand('A1', ['B1'])).toBe(false);
    expect(inOwnerBand(null, ['B1'])).toBe(false);
    expect(inOwnerBand('B1', [])).toBe(false);
  });

  it('tiers never overlap: cards > owner band > top lemmas, and all stay below user requests', () => {
    const cefr = fc.constantFrom<Cefr | null>(null, 'A1', 'A2', 'B1', 'B2', 'C1', 'C2');
    const input = fc.record({
      inAdminCards: fc.boolean(),
      users: fc.integer({ min: 0, max: 5000 }),
      cefr,
      ownerLevels: fc.constantFrom<Cefr[]>([], ['B1'], ['A2', 'C1']),
      zipf: fc.option(fc.double({ min: 0, max: 9, noNaN: true }), { nil: null }),
      inTop: fc.boolean(),
    });
    const tier = (p: PriorityInput) =>
      p.inAdminCards ? 4 : p.users > 0 ? 3 : inOwnerBand(p.cefr, p.ownerLevels) ? 2 : p.inTop ? 1 : 0;
    fc.assert(
      fc.property(input, input, (a, b) => {
        const pa = autoPriority(a);
        const pb = autoPriority(b);
        if (pa !== null) expect(pa).toBeLessThan(3000);
        if (tier(a) === 0) expect(pa).toBeNull();
        if (tier(a) > tier(b) && pb !== null) expect(pa!).toBeGreaterThan(pb);
      }),
    );
  });

  it('within a frequency tier, the more frequent word comes first', () => {
    const p = (zipf: number) => autoPriority({ ...base, cefr: 'B1', zipf })!;
    expect(p(6.1)).toBeGreaterThan(p(4.2));
    const q = (zipf: number) => autoPriority({ ...base, inTop: true, zipf })!;
    expect(q(6.1)).toBeGreaterThan(q(4.2));
  });
});
