// @vitest-environment node
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  buildMorphology,
  cleanEdges,
  etymologyMorphs,
  hasRootEvidence,
  parseMorphyNet,
  rootEvidenceTokens,
  sharesStem,
  templateMorphs,
  vocabFromWordfreq,
  type Edge,
  type Vocab,
} from './build.ts';
import { INVENTORY } from './inventory.ts';
import { decodeMsgpack } from './msgpack.ts';
import { readZipEntry } from './zip.ts';

// ------------------------------------------------------------------ fixtures

/** Encodes the subset decodeMsgpack reads: arrays, maps, short strings, small ints. */
function msgpack(v: unknown): number[] {
  const enc = new TextEncoder();
  if (typeof v === 'number') return [v];
  if (typeof v === 'string') {
    const b = [...enc.encode(v)];
    return b.length < 32 ? [0xa0 | b.length, ...b] : [0xd9, b.length, ...b];
  }
  if (Array.isArray(v)) {
    const head = v.length < 16 ? [0x90 | v.length] : [0xdc, v.length >> 8, v.length & 0xff];
    return [...head, ...v.flatMap(msgpack)];
  }
  const entries = Object.entries(v as Record<string, unknown>);
  return [0x80 | entries.length, ...entries.flatMap(([k, x]) => [...msgpack(k), ...msgpack(x)])];
}

/** A two-file zip: one stored entry, one deflated. */
function zip(files: { name: string; data: Uint8Array; deflate: boolean }[]): Uint8Array {
  const enc = new TextEncoder();
  const local: number[] = [];
  const central: number[] = [];
  const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
  const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
  for (const f of files) {
    const name = [...enc.encode(f.name)];
    const body = f.deflate ? deflateRawSync(f.data) : f.data;
    const offset = local.length;
    const method = f.deflate ? 8 : 0;
    local.push(...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(method), ...u32(0), ...u32(0));
    local.push(...u32(body.length), ...u32(f.data.length), ...u16(name.length), ...u16(0), ...name, ...body);
    central.push(...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(method), ...u32(0), ...u32(0));
    central.push(...u32(body.length), ...u32(f.data.length), ...u16(name.length), ...u16(0), ...u16(0));
    central.push(...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name);
  }
  const eocd = [...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length)];
  eocd.push(...u32(central.length), ...u32(local.length), ...u16(0));
  return new Uint8Array([...local, ...central, ...eocd]);
}

const edge = (source: string, target: string, morpheme: string, type: Edge['type'] = 'suffix', sp: Edge['sourcePos'] = 'V', tp: Edge['targetPos'] = 'N'): Edge => ({
  source,
  target,
  sourcePos: sp,
  targetPos: tp,
  morpheme,
  type,
});

function vocabOf(words: string[]): Vocab {
  return {
    rank: new Map(words.map((w, i) => [w, i])),
    zipf: new Map(words.map((w, i) => [w, 6 - i / 100])),
  };
}

// ------------------------------------------------------------------ parsers

describe('wordfreq input', () => {
  it('decodes msgpack and keeps the most frequent alphabetic words', () => {
    const data = [{ format: 'cB', version: 1 }, ['the', 'of'], [], ['and', "don't", 'A', 'x', 'a', 'of', 'café'], ['inspect']];
    const decoded = decodeMsgpack(new Uint8Array(msgpack(data)));
    expect(decoded).toEqual(data);
    const v = vocabFromWordfreq(decoded, 4);
    expect([...v.rank.keys()]).toEqual(['the', 'of', 'and', 'a']);
    expect(v.zipf.get('the')).toBe(9);
    expect(v.zipf.get('and')).toBe(8.98);
  });

  it('rejects a file that is not a wordfreq cB list', () => {
    expect(() => vocabFromWordfreq([{ format: 'other' }])).toThrow(/format/);
    expect(() => decodeMsgpack(new Uint8Array([0xc1]))).toThrow(/unsupported/);
  });

  it('reads stored and deflated entries out of a wheel', () => {
    const text = new TextEncoder().encode('wordfreq '.repeat(50));
    const z = zip([
      { name: 'a.txt', data: new Uint8Array([1, 2, 3]), deflate: false },
      { name: 'wordfreq/data/large_en.msgpack.gz', data: text, deflate: true },
    ]);
    expect([...readZipEntry(z, 'a.txt')]).toEqual([1, 2, 3]);
    expect(new TextDecoder().decode(readZipEntry(z, 'wordfreq/data/large_en.msgpack.gz'))).toBe('wordfreq '.repeat(50));
    expect(() => readZipEntry(z, 'missing')).toThrow(/not found/);
  });
});

describe('MorphyNet', () => {
  it('parses the six-column TSV and skips malformed lines', () => {
    const tsv = 'inspect\tinspection\tV\tN\tion\tsuffix\r\nbad line\nkind\tunkind\tJ\tJ\tun\tprefix\nx\ty\tQ\tN\tion\tsuffix\n';
    expect(parseMorphyNet(tsv)).toEqual([edge('inspect', 'inspection', 'ion'), edge('kind', 'unkind', 'un', 'prefix', 'J', 'J')]);
  });

  it('requires the derived word to keep its base', () => {
    expect(sharesStem(edge('moon', 'month', 'th'))).toBe(false);
    expect(sharesStem(edge('decide', 'decision', 'ion'))).toBe(true);
    expect(sharesStem(edge('kind', 'unkind', 'un', 'prefix'))).toBe(true);
  });

  it('cleans edges: vocabulary only, known affixes, no compounds, one parent per word', () => {
    const vocab = new Set(['work', 'man', 'workman', 'out', 'ward', 'outward', 'mean', 'meaning', 'meaningful', 'walk', 'walking', 'kind', 'kindness', 'rare']);
    const out = cleanEdges(
      [
        edge('work', 'workman', 'man'), // compound
        edge('out', 'outward', 'ward'),
        edge('ward', 'outward', 'out', 'prefix'),
        edge('mean', 'meaning', 'ing'), // kept: meaning is a base of meaningful
        edge('meaning', 'meaningful', 'ful', 'suffix', 'N', 'J'),
        edge('walk', 'walking', 'ing'), // dropped: plain -ing form
        edge('kind', 'kindness', 'ness', 'suffix', 'J', 'N'),
        edge('kind', 'kindly', 'ly'), // kindly not in vocabulary
        edge('rare', 'rarezz', 'zz'), // unknown affix
      ],
      vocab,
    );
    const pairs = out.map((e) => `${e.source}>${e.target}`).sort();
    expect(pairs).toEqual(['kind>kindness', 'mean>meaning', 'meaning>meaningful', 'ward>outward']);
  });
});

describe('Wiktionary etymologies', () => {
  it('reads the surface analysis', () => {
    expect(etymologyMorphs('From Latin inspectus. Equivalent to in- + -spect.')).toEqual(['in-', '-spect']);
    expect(etymologyMorphs('By surface analysis, decide + -ion.')).toEqual(['-ion']);
    expect(etymologyMorphs('From Old English cynd.')).toEqual([]);
  });

  it('reads kaikki affix templates', () => {
    expect(
      templateMorphs([
        { name: 'af', args: { '1': 'en', '2': 'un-', '3': 'kind' } },
        { name: 'prefix', args: { '1': 'en', '2': 're', '3': 'do' } },
        { name: 'suffix', args: { '1': 'en', '2': 'kind', '3': 'ness' } },
        { name: 'af', args: { '1': 'fr', '2': 're-', '3': 'x' } },
        { name: 'inh', args: { '1': 'en', '2': 'ang', '3': 'cynd' } },
      ]),
    ).toEqual(['un-', 're-', '-ness']);
    expect(templateMorphs(undefined)).toEqual([]);
  });

  it('matches root evidence only on whole ancestor tokens, not on cognates', () => {
    const spect = INVENTORY.find((d) => d.id === 'spect')!;
    const mit = INVENTORY.find((d) => d.id === 'mit')!;
    expect(hasRootEvidence(spect, rootEvidenceTokens('From Latin īnspectus, from īnspiciō.'))).toBe(true);
    expect(hasRootEvidence(spect, rootEvidenceTokens('From Middle English special'))).toBe(false);
    expect(hasRootEvidence(mit, rootEvidenceTokens('From Old English missan. Cognate with Latin mittere.'))).toBe(false);
    expect(hasRootEvidence(mit, rootEvidenceTokens('From Latin permittere.'))).toBe(true);
    expect(rootEvidenceTokens('Spéciō  SEE')).toEqual(new Set(['specio', 'see']));
  });
});

// ------------------------------------------------------------------ build

describe('buildMorphology', () => {
  const words = ['respect', 'inspect', 'inspection', 'inspector', 'spectator', 'respectful', 'kind', 'kindness', 'unkind', 'happy', 'happiness', 'unhappy', 'unkindness', 'special', 'sad'];
  const edges: Edge[] = [
    edge('inspect', 'inspection', 'ion'),
    edge('inspect', 'inspector', 'or'),
    edge('respect', 'respectful', 'ful', 'suffix', 'N', 'J'),
    edge('kind', 'kindness', 'ness', 'suffix', 'J', 'N'),
    edge('kind', 'unkind', 'un', 'prefix', 'J', 'J'),
    edge('happy', 'happiness', 'ness', 'suffix', 'J', 'N'),
    edge('happy', 'unhappy', 'un', 'prefix', 'J', 'J'),
    edge('unkind', 'unkindness', 'ness', 'suffix', 'J', 'N'),
  ];
  const etymology = new Map([
    ['inspect', { text: 'From Latin inspectus, from inspicio.' }],
    ['respect', { text: 'From Latin respectus, from respicere.' }],
    ['spectator', { text: 'From Latin spectator.' }],
    ['special', { text: 'From Old French especial, from Latin specialis.' }],
    ['sad', { text: 'From Old English sæd.' }],
  ]);
  const out = buildMorphology({ vocab: vocabOf(words), edges, etymology });
  const row = (w: string) => out.words.find((r) => r[0] === w);
  const idsOf = (w: string) => (row(w)?.[3] ?? []).map((i) => out.morphemes[i]!.id);
  const familyOf = (w: string) => out.families[row(w)?.[2] ?? -1];

  it('groups derived words into families with the base first', () => {
    expect(familyOf('inspection')).toEqual(['inspect', 'inspection', 'inspector']);
    expect(familyOf('unkind')?.[0]).toBe('kind');
    expect(row('sad')).toBeUndefined();
  });

  it('assigns affixes and inherits them along the derivation chain', () => {
    expect(idsOf('kindness')).toEqual(['-ness']);
    expect(idsOf('unhappy')).toContain('un-');
    expect(idsOf('unkindness')).toEqual(expect.arrayContaining(['un-', '-ness']));
    expect(familyOf('unkindness')).toEqual(['kind', 'kindness', 'unkind', 'unkindness']);
  });

  it('assigns a root only with spelling and etymology evidence', () => {
    for (const w of ['inspect', 'inspection', 'respect', 'respectful', 'spectator']) expect(idsOf(w)).toContain('spect');
    expect(idsOf('special')).not.toContain('spect');
  });

  it('keeps morphemes carried by at least three words, and only derived words get a POS', () => {
    const ids = out.morphemes.map((m) => m.id);
    expect(ids).toContain('spect');
    expect(ids).not.toContain('-or'); // only inspector
    expect(ids).not.toContain('-tion'); // only inspection
    expect(row('kindness')?.[1]).toBe('noun');
    expect(row('kind')?.[1]).toBe('');
  });

  it('leaves out families that are larger than maxFamily', () => {
    const small = buildMorphology({ vocab: vocabOf(words), edges, etymology, maxFamily: 2 });
    expect(small.families.every((f) => f.length <= 2)).toBe(true);
    expect(small.stats).toBeDefined();
  });
});
