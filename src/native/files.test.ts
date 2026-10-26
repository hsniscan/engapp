import { beforeEach, describe, expect, it, vi } from 'vitest';

const writeFile = vi.fn();
const share = vi.fn();
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Documents: 'DOCUMENTS', Cache: 'CACHE' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: { writeFile: (o: unknown) => writeFile(o) },
}));
vi.mock('@capacitor/share', () => ({ Share: { share: (o: unknown) => share(o) } }));

const { saveNativeFile } = await import('./files');

beforeEach(() => {
  writeFile.mockReset();
  share.mockReset();
});

describe('saveNativeFile', () => {
  it('writes to Documents and reports the path the Files app shows', async () => {
    writeFile.mockResolvedValue({ uri: 'file:///storage/Documents/b.json' });
    const r = await saveNativeFile('b.json', '{}', 'Engapp yedeği');
    expect(writeFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'b.json', directory: 'DOCUMENTS', data: '{}' }),
    );
    expect(share).not.toHaveBeenCalled();
    expect(r).toEqual({
      ok: true,
      how: 'documents',
      location: 'Documents/b.json',
      uri: 'file:///storage/Documents/b.json',
    });
  });

  it('Documents refused: cache + share sheet', async () => {
    writeFile
      .mockRejectedValueOnce(new Error('permission'))
      .mockResolvedValueOnce({ uri: 'file:///cache/b.json' });
    share.mockResolvedValue({});
    const r = await saveNativeFile('b.json', '{}', 'Engapp yedeği');
    expect(writeFile.mock.calls[1]![0]).toMatchObject({ directory: 'CACHE' });
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ files: ['file:///cache/b.json'] }),
    );
    expect(r).toMatchObject({ ok: true, how: 'shared' });
  });

  it('share sheet cancelled: not saved', async () => {
    writeFile
      .mockRejectedValueOnce(new Error('permission'))
      .mockResolvedValueOnce({ uri: 'file:///cache/b.json' });
    share.mockRejectedValue(new Error('Share canceled'));
    expect(await saveNativeFile('b.json', '{}', 't')).toEqual({ ok: false, cancelled: true });
  });
});
