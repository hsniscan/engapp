// The correction line under a word's level (decision 0073): a familiar international word says
// "Türkçede de var: mikrofon" instead of crediting the AI; the AI's own reason stays as it was.
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '@/i18n';
import { familiarWord, useCorrectionLine } from './levelText';

describe('familiarWord', () => {
  it('reads the Turkish word of a familiar-word reason', () => {
    expect(familiarWord('tanidik:mikrofon')).toBe('mikrofon');
    expect(familiarWord(' tanidik: penisilin ')).toBe('penisilin');
  });
  it('is null for any other reason', () => {
    expect(familiarWord("Türkçede 'televizyon'")).toBeNull();
    expect(familiarWord(null)).toBeNull();
    expect(familiarWord('tanidik:')).toBeNull();
  });
});

describe('useCorrectionLine', () => {
  it('names the Turkish word for a familiar word', () => {
    const { result } = renderHook(() =>
      useCorrectionLine({ cefr: 'B1', list_cefr: 'B2', reason_tr: 'tanidik:mikrofon', source: 'cefrj' }),
    );
    expect(result.current).toBe('CEFR-J: B2 → Türk öğrenci için B1 (Türkçede de var: mikrofon)');
  });
  it('keeps the AI reason of a level-tr correction', () => {
    const { result } = renderHook(() =>
      useCorrectionLine({ cefr: 'A2', list_cefr: 'B1', reason_tr: "Türkçede 'televizyon'", source: 'cefrj' }),
    );
    expect(result.current).toBe("CEFR-J: B1 → Türk öğrenci için A2 (yapay zekâ: Türkçede 'televizyon')");
  });
});
