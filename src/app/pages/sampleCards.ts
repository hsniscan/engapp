/** Sample content for placeholders and the /dev/ui gallery (data, not UI strings). */
export const sampleCards = [
  {
    term: 'meticulous',
    ipa: '/məˈtɪkjələs/',
    pos: 'adj.',
    meaning: 'titiz, çok dikkatli',
    example: 'She kept meticulous notes of every experiment.',
    exampleTr: 'Her deneyin notunu titizlikle tuttu.',
  },
  {
    term: 'reluctant',
    ipa: '/rɪˈlʌktənt/',
    pos: 'adj.',
    meaning: 'gönülsüz, isteksiz',
    example: 'He was reluctant to admit his mistake.',
    exampleTr: 'Hatasını kabul etmeye gönülsüzdü.',
  },
  {
    term: 'to come up with',
    ipa: '/kʌm ʌp wɪð/',
    pos: 'phr. v.',
    meaning: '(fikir, çözüm) bulmak, ortaya atmak',
    example: 'We need to come up with a better plan.',
    exampleTr: 'Daha iyi bir plan bulmamız gerekiyor.',
  },
] as const;

export type SampleCard = (typeof sampleCards)[number];

export const sampleIntervals = { again: '1 dk', hard: '8 dk', good: '1 g', easy: '4 g' } as const;
