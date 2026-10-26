// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { checkLicenses, fromPnpmJson, isAllowed, parseSpdx } from './check-licenses.ts';

describe('isAllowed', () => {
  it('accepts the allowlist', () => {
    for (const l of [
      'MIT',
      'Apache-2.0',
      'BSD-2-Clause',
      'BSD-3-Clause',
      'ISC',
      '0BSD',
      'CC0-1.0',
      'Unlicense',
      'Python-2.0',
      'BlueOak-1.0.0',
    ])
      expect(isAllowed(l), l).toBe(true);
  });

  it('OR needs one allowed side, AND needs both', () => {
    expect(isAllowed('(MIT OR GPL-3.0-or-later)')).toBe(true);
    expect(isAllowed('(MIT OR CC0-1.0)')).toBe(true);
    expect(isAllowed('(MIT AND Zlib)')).toBe(false);
    expect(isAllowed('(MIT AND BSD-3-Clause)')).toBe(true);
    expect(isAllowed('MIT OR Apache-2.0 AND GPL-2.0')).toBe(true); // AND binds tighter
    expect(isAllowed('GPL-2.0 OR Apache-2.0 AND GPL-3.0')).toBe(false);
  });

  it('rejects copyleft, unknown and malformed licences', () => {
    for (const l of [
      'GPL-3.0',
      'AGPL-3.0',
      'LGPL-2.1',
      'MPL-2.0',
      'CC-BY-NC-4.0',
      'UNKNOWN',
      'UNLICENSED',
      '',
      'SEE LICENSE IN LICENSE.md',
      '(MIT',
      'MIT AND',
    ])
      expect(isAllowed(l), l).toBe(false);
    expect(isAllowed('Apache-2.0 WITH LLVM-exception')).toBe(false);
  });

  it('knows common non-SPDX spellings', () => {
    expect(isAllowed('Apache 2.0')).toBe(true);
    expect(isAllowed('MIT License')).toBe(true);
  });

  it('parses nested expressions', () => {
    expect(parseSpdx('(A OR (B AND C))')).toEqual({
      op: 'OR',
      left: { id: 'A' },
      right: { op: 'AND', left: { id: 'B' }, right: { id: 'C' } },
    });
  });
});

describe('checkLicenses', () => {
  const pkgs = fromPnpmJson({
    MIT: [{ name: 'react', versions: ['19.3.1'], license: 'MIT' }],
    'OFL-1.1': [{ name: '@fontsource/source-serif-4', versions: ['5.3.1'], license: 'OFL-1.1' }],
    'GPL-3.0': [{ name: 'some-gpl-lib', versions: ['1.0.0'], license: 'GPL-3.0' }],
    'MPL-2.0': [{ name: 'lightningcss', versions: ['1.33.0'], license: 'MPL-2.0' }],
  });

  it('fails on a package outside the allowlist and lists the reviewed ones', () => {
    const r = checkLicenses(pkgs);
    expect(r.checked).toBe(4);
    expect(r.failed.map((p) => p.name)).toEqual(['some-gpl-lib']);
    expect(r.reviewed.map((p) => p.name)).toEqual(['@fontsource/source-serif-4', 'lightningcss']);
  });

  it('fails again when a reviewed package changes its licence', () => {
    const r = checkLicenses([{ name: 'lightningcss', versions: ['2.0.0'], license: 'GPL-3.0' }]);
    expect(r.failed.map((p) => p.name)).toEqual(['lightningcss']);
  });

  it('reads the licence from the group when the entry has none', () => {
    expect(fromPnpmJson({ ISC: [{ name: 'x', versions: ['1'] }] })).toEqual([
      { name: 'x', versions: ['1'], license: 'ISC' },
    ]);
  });
});
