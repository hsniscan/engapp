/** Sample content for the /dev/preview design mock-ups (data, not UI strings). */
export const previewReading = {
  title: 'The Quiet Library',
  excerpt:
    'Every morning, Mara unlocked the old library before the town woke up. She liked the silence between the shelves.',
  /** Tokens of the reader body; `mark` = how the reader highlights the word. */
  paragraphs: [
    [
      [
        'Every morning, Mara unlocked the old library before the town woke up. She carried a small ',
      ],
      ['lantern', 'new'],
      [' even in summer, because the back rooms were dark and the '],
      ['corridors', 'learning'],
      [' smelled of paper and rain.'],
    ],
    [
      ['She was not a '],
      ['meticulous', 'learning'],
      [
        ' person by nature, but the books had taught her patience. Each returned volume went back to its exact place, its ',
      ],
      ['spine', 'new'],
      [' facing out, its title level with its neighbours.'],
    ],
    [
      ['One afternoon a boy came in, '],
      ['reluctant', 'learning'],
      [' and wet, and asked for a book about the sea. Mara smiled. She knew exactly where it was.'],
    ],
  ] as [string, ('new' | 'learning')?][][],
  word: {
    term: 'lantern',
    ipa: '/ˈlæntərn/',
    pos: 'n.',
    meaning: 'fener',
    example: 'She carried a small lantern even in summer.',
    exampleTr: 'Yazın bile küçük bir fener taşırdı.',
  },
} as const;
