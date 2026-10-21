// Input files of the morphology pipeline. Every source is free to use commercially; the
// licence of each was checked by hand (docs/licenses/morphology.md). Pinned sources carry a
// SHA-256 that the download step verifies. kaikki.org has no versioned URLs (it is rebuilt
// from the Wiktionary dump every few days), so its checksum and download date are recorded
// in the build's sources file instead.

export interface Source {
  key: 'wordfreq' | 'morphynet' | 'kaikki' | 'kaikki-mirror';
  name: string;
  version: string;
  url: string;
  sha256: string | null;
  license: string;
  licenseUrl: string;
  attribution: string;
}

export const SOURCES: Record<Source['key'], Source> = {
  wordfreq: {
    key: 'wordfreq',
    name: 'wordfreq (English "large" frequency list)',
    version: '3.1.1',
    url: 'https://files.pythonhosted.org/packages/24/61/62835c475d69872d30689f284497853fe33fe1d6dd18f57346d13305861d/wordfreq-3.1.1-py3-none-any.whl',
    sha256: '4b1c6ecffc6198be3396d5cf871c4423ca71c907c231348d352dd54d62b97473',
    license: 'CC BY-SA 4.0 (data); Apache-2.0 (code)',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    attribution: 'Robyn Speer, wordfreq v3.1.1 (2022), https://github.com/rspeer/wordfreq',
  },
  morphynet: {
    key: 'morphynet',
    name: 'MorphyNet English derivational morphology (eng.derivational.v1.tsv)',
    version: 'v1, commit 378144f64df58c78db5245af19d16a511ccecf3a',
    url: 'https://raw.githubusercontent.com/kbatsuren/MorphyNet/378144f64df58c78db5245af19d16a511ccecf3a/eng/eng.derivational.v1.tsv',
    sha256: '5920edacc1888b14464fc5cd96beea0a721221d56d1dc0e49de22f4c7c537c50',
    license: 'CC BY-SA 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
    attribution:
      'Khuyagbaatar Batsuren, Gábor Bella, Fausto Giunchiglia: MorphyNet: a Large Multilingual Database of Derivational and Inflectional Morphology (SIGMORPHON 2021), https://github.com/kbatsuren/MorphyNet',
  },
  kaikki: {
    key: 'kaikki',
    name: 'Wiktionary English, machine-readable (kaikki.org / wiktextract)',
    version: 'download date (see sources file)',
    url: 'https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl',
    sha256: null,
    license: 'CC BY-SA 4.0 and GFDL (Wiktionary content)',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    attribution:
      'Wiktionary contributors, https://en.wiktionary.org; extracted by Tatu Ylonen, wiktextract (kaikki.org)',
  },
  // kaikki.org is not reachable from every build machine. This mirror republishes the
  // kaikki English extract (headword, senses, etymology text; no etymology templates)
  // under the same licence; the build then reads etymology text only.
  'kaikki-mirror': {
    key: 'kaikki-mirror',
    name: 'Wiktionary English via kaikki.org, SQLite mirror (thymesis-dictionary kaikki-en-v1)',
    version: 'kaikki-en-v1 (repository commit 674989f6e6081ef89e1f2e65659825fbe0e81afd)',
    url: 'https://github.com/ZexiKuang/thymesis-dictionary/releases/download/kaikki-en-v1/kaikki_en.sqlite',
    sha256: '043014669e0c0242be3bd93ec2e48084b5e2a8c9843800fbc664230b9faece1a',
    license: 'CC BY-SA 4.0 and GFDL (Wiktionary content)',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    attribution:
      'Wiktionary contributors, https://en.wiktionary.org; extracted by kaikki.org / wiktextract; SQLite packaging by the thymesis-dictionary project',
  },
};
