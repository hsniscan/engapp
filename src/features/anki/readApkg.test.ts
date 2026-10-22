import { describe, expect, it } from 'vitest';
import { ApkgError, readApkg } from './readApkg';
import { buildApkg, sampleDeck } from './testing/buildApkg';
import { nodeLibs } from './testing/nodeLibs';

describe('readApkg', () => {
  it.each(['anki2', 'anki21', 'anki21b'] as const)('reads the %s format', async (format) => {
    const libs = await nodeLibs();
    const bytes = await buildApkg(sampleDeck(), format, libs);
    const col = await readApkg(bytes, libs);
    expect(col.format).toBe(format);
    expect(col.notes).toHaveLength(7);
    expect(col.cards).toHaveLength(13);
    expect(col.revlog).toHaveLength(8 + 1 + 8 + 1 + 1 + 2 + 1);
    expect(col.mediaFiles).toBe(2);
    expect(col.schedVer).toBe(2);
    const basic = col.noteTypes.find((n) => n.name === 'Basic (and reversed card)');
    expect(basic).toMatchObject({ kind: 'normal', fields: ['Front', 'Back', 'Example'] });
    expect(basic?.templates.map((t) => t.front)).toEqual(['{{Front}}', '{{Back}}']);
    expect(col.noteTypes.find((n) => n.name === 'Cloze')?.kind).toBe('cloze');
    const first = col.notes[0]!;
    expect(first).toMatchObject({ mid: basic!.id, tags: ['adjectives', 'b2'] });
    expect(first.fields[0]).toBe('reluctant');
    expect(col.cards.find((c) => c.nid === col.notes[2]!.id)?.queue).toBe(-1);
  });

  it('reads the old v1 scheduler version', async () => {
    const libs = await nodeLibs();
    for (const format of ['anki2', 'anki21b'] as const) {
      const col = await readApkg(await buildApkg({ ...sampleDeck(), schedVer: 1 }, format, libs), libs);
      expect(col.schedVer).toBe(1);
    }
  });

  it('rejects files that are not Anki packages', async () => {
    const libs = await nodeLibs();
    await expect(readApkg(new TextEncoder().encode('hello'), libs)).rejects.toMatchObject({ code: 'not_apkg' });
    const zip = new libs.JSZip();
    zip.file('notes.txt', 'x');
    const empty = await zip.generateAsync({ type: 'uint8array' });
    await expect(readApkg(empty, libs)).rejects.toBeInstanceOf(ApkgError);
    await expect(readApkg(empty, libs)).rejects.toMatchObject({ code: 'no_collection' });
    const broken = new libs.JSZip();
    broken.file('collection.anki21b', new Uint8Array([1, 2, 3]));
    await expect(readApkg(await broken.generateAsync({ type: 'uint8array' }), libs)).rejects.toMatchObject({ code: 'unreadable' });
  });
});
