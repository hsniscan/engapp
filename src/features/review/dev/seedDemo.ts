// Dev-only demo data: realistic words (multi-sense words, phrasal verbs, sentences) plus a
// simulated review history, produced through the real data actions with past timestamps.
// Not imported by app code. Use from the browser console or Playwright in `pnpm dev`:
//   const m = await import('/src/features/review/dev/seedDemo.ts'); await m.seedDemo();
import {
  addNoteWithSenses,
  answerCard,
  db,
  ensureSettings,
  getStudyQueue,
  type SenseInput,
} from '@/data';
import { dayBounds, isValidTimeZone } from '@/domain/day';
import { findSpan } from '@/domain/recognition';
import { CardState, type RatingValue, type TermType } from '@/domain/types';

type Word = [
  term: string,
  ipa: string,
  type: TermType,
  senses: [meaning: string, pos: string, gloss: string, sentence?: string][],
];

export const DEMO_WORDS: Word[] = [
  [
    'bank',
    '/bæŋk/',
    'word',
    [
      [
        'banka',
        'n.',
        'an organisation that keeps and lends money',
        'She opened an account at the bank on Monday.',
      ],
      ['kıyı', 'n.', 'the land beside a river', 'We had a picnic on the bank of the river.'],
    ],
  ],
  [
    'run',
    '/rʌn/',
    'word',
    [
      ['koşmak', 'v.', 'move fast on foot', 'I run five kilometres every morning.'],
      ['yönetmek, işletmek', 'v.', 'manage a business', 'She runs a small bakery in Kadıköy.'],
    ],
  ],
  [
    'fair',
    '/feə/',
    'word',
    [
      ['adil', 'adj.', 'treating people equally', 'The referee made a fair decision.'],
      [
        'fuar, panayır',
        'n.',
        'an event with stalls and rides',
        'We bought honey at the county fair.',
      ],
    ],
  ],
  [
    'light',
    '/laɪt/',
    'word',
    [
      [
        'ışık',
        'n.',
        'the brightness from the sun or a lamp',
        'The light from the window woke me up.',
      ],
      ['hafif', 'adj.', 'not heavy', 'This laptop is light enough to carry all day.'],
    ],
  ],
  [
    'give up',
    '/ɡɪv ˈʌp/',
    'phrase',
    [
      [
        'vazgeçmek, bırakmak',
        'phr. v.',
        'stop doing something',
        'He decided to give up smoking last year.',
      ],
    ],
  ],
  [
    'come up with',
    '/kʌm ˈʌp wɪð/',
    'phrase',
    [
      [
        '(fikir, çözüm) bulmak',
        'phr. v.',
        'think of an idea or plan',
        'We need to come up with a better plan.',
      ],
    ],
  ],
  [
    'look into',
    '/lʊk ˈɪntuː/',
    'phrase',
    [
      [
        'araştırmak, incelemek',
        'phr. v.',
        'investigate',
        'The manager promised to look into the problem.',
      ],
    ],
  ],
  [
    'put off',
    '/pʊt ˈɒf/',
    'phrase',
    [
      [
        'ertelemek',
        'phr. v.',
        'delay doing something',
        "Don't put off until tomorrow what you can do today.",
      ],
    ],
  ],
  [
    'carry on',
    '/ˈkæri ɒn/',
    'phrase',
    [['devam etmek', 'phr. v.', 'continue', 'Please carry on with your work.']],
  ],
  [
    'meticulous',
    '/məˈtɪkjələs/',
    'word',
    [
      [
        'titiz, çok dikkatli',
        'adj.',
        'very careful about details',
        'She kept meticulous notes of every experiment.',
      ],
    ],
  ],
  [
    'reluctant',
    '/rɪˈlʌktənt/',
    'word',
    [
      [
        'gönülsüz, isteksiz',
        'adj.',
        'not willing to do something',
        'He was reluctant to admit his mistake.',
      ],
    ],
  ],
  [
    'thorough',
    '/ˈθʌrə/',
    'word',
    [
      [
        'eksiksiz, kapsamlı',
        'adj.',
        'complete and careful',
        'The doctor gave me a thorough examination.',
      ],
    ],
  ],
  [
    'however',
    '/haʊˈevə/',
    'word',
    [
      [
        'ancak, yine de',
        'adv.',
        'used to add a contrast',
        'The plan was good; however, it was too expensive.',
      ],
    ],
  ],
  [
    'issue',
    '/ˈɪʃuː/',
    'word',
    [
      [
        'sorun, mesele',
        'n.',
        'a problem or subject to discuss',
        'We have an issue with the payment system.',
      ],
      [
        'sayı (dergi)',
        'n.',
        'one edition of a magazine',
        'The new issue of the magazine came out today.',
      ],
    ],
  ],
  [
    'spring',
    '/sprɪŋ/',
    'word',
    [
      ['ilkbahar', 'n.', 'the season after winter', 'The garden looks beautiful in spring.'],
      ['yay', 'n.', 'a coil of metal that returns to shape', 'The old sofa has a broken spring.'],
    ],
  ],
  [
    'deadline',
    '/ˈdedlaɪn/',
    'word',
    [
      [
        'son teslim tarihi',
        'n.',
        'the time by which something must be done',
        'The deadline for the report is Friday.',
      ],
    ],
  ],
  [
    'figure out',
    '/ˈfɪɡər aʊt/',
    'phrase',
    [
      [
        'çözmek, anlamak',
        'phr. v.',
        'understand or solve',
        "I can't figure out how this machine works.",
      ],
    ],
  ],
  [
    'eventually',
    '/ɪˈventʃuəli/',
    'word',
    [
      [
        'sonunda, en sonunda',
        'adv.',
        'after a long time',
        'Eventually, they found the missing keys.',
      ],
    ],
  ],
  [
    'available',
    '/əˈveɪləbl/',
    'word',
    [['müsait, mevcut', 'adj.', 'free to be used or seen', 'Is the room available next week?']],
  ],
  [
    'sustainable',
    '/səˈsteɪnəbl/',
    'word',
    [
      [
        'sürdürülebilir',
        'adj.',
        'able to continue for a long time',
        'We need a more sustainable energy policy.',
      ],
    ],
  ],
  [
    'overwhelm',
    '/ˌəʊvəˈwelm/',
    'word',
    [
      [
        'bunaltmak',
        'v.',
        'be too much for someone',
        'The amount of homework can overwhelm students.',
      ],
    ],
  ],
  [
    'take over',
    '/teɪk ˈəʊvə/',
    'phrase',
    [
      [
        'devralmak',
        'phr. v.',
        'take control of something',
        'She will take over the project next month.',
      ],
    ],
  ],
  [
    'rather than',
    '/ˈrɑːðə ðæn/',
    'pattern',
    [['-mek yerine', 'phrase', 'instead of', "I'd walk rather than wait for the bus."]],
  ],
  [
    'settle',
    '/ˈsetl/',
    'word',
    [
      ['yerleşmek', 'v.', 'start living in a place', 'They decided to settle in İzmir.'],
      ['halletmek, çözmek', 'v.', 'end a disagreement', 'We need to settle this argument today.'],
    ],
  ],
  [
    'notice',
    '/ˈnəʊtɪs/',
    'word',
    [
      ['fark etmek', 'v.', 'see or become aware of', 'Did you notice the new sign?'],
      ['ilan, duyuru', 'n.', 'a written announcement', 'There is a notice on the door.'],
    ],
  ],
  [
    'approach',
    '/əˈprəʊtʃ/',
    'word',
    [['yaklaşım', 'n.', 'a way of dealing with something', 'I like her approach to teaching.']],
  ],
  [
    'likely',
    '/ˈlaɪkli/',
    'word',
    [['muhtemel', 'adj.', 'probably going to happen', 'It is likely to rain this afternoon.']],
  ],
  [
    'run out of',
    '/rʌn ˈaʊt əv/',
    'phrase',
    [['tükenmek, bitmek', 'phr. v.', 'have none left', "We've run out of milk again."]],
  ],
  [
    'point out',
    '/pɔɪnt ˈaʊt/',
    'phrase',
    [
      [
        'belirtmek, dikkat çekmek',
        'phr. v.',
        'tell someone a fact',
        'She was quick to point out a mistake in the report.',
      ],
    ],
  ],
  ['awkward', '/ˈɔːkwəd/', 'word', [['garip, tuhaf; sıkıntılı', 'adj.', 'causing embarrassment']]],
  [
    'meanwhile',
    '/ˈmiːnwaɪl/',
    'word',
    [['bu sırada', 'adv.', 'at the same time', 'Meanwhile, the water was boiling.']],
  ],
];

const DAY = 86_400_000;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function toInput([term, ipa, type, senses]: Word) {
  return {
    term,
    ipa,
    term_type: type,
    senses: senses.map(([meaning, pos, gloss, sentence]): SenseInput => ({
      meaning_tr: meaning,
      pos,
      gloss_en: gloss,
      source_sentence: sentence ?? null,
      span: sentence ? findSpan(sentence, term) : null,
    })),
  };
}

export interface SeedOptions {
  /** Days of simulated history. */
  days?: number;
  /** Words added today (new cards for today's session). */
  freshToday?: number;
  seed?: number;
  now?: number;
}

/**
 * Adds DEMO_WORDS over the last `days` days and answers each day's queue at 19:00-ish with
 * mostly-good ratings. Leaves today's queue untouched (due reviews of all three card types
 * plus a few new cards). Streak: the last 12 days are active; there are gaps earlier.
 */
export async function seedDemo(
  opts: SeedOptions = {},
): Promise<{ notes: number; answers: number }> {
  const now = opts.now ?? Date.now();
  const days = opts.days ?? 120;
  const fresh = opts.freshToday ?? 3;
  const rand = rng(opts.seed ?? 7);
  const settings = await ensureSettings(now - days * DAY);
  const tz = isValidTimeZone(settings.timezone) ? settings.timezone : 'UTC';
  // Midday of each local study day, so no answer slips across the 04:00 day boundary.
  const todayStart = dayBounds(now, {
    timezone: tz,
    day_start_hour: settings.day_start_hour,
  }).start;
  const start = todayStart - days * DAY;

  const words = DEMO_WORDS.slice(0, DEMO_WORDS.length - fresh);
  const addAt = (i: number) =>
    start + Math.floor((i * days * 0.7) / words.length) * DAY + 3_600_000;
  let added = 0;
  let answers = 0;

  for (let d = 0; d < days; d++) {
    const dayTime = start + d * DAY + 10 * 3_600_000; // 14:00 with a 04:00 day start
    while (added < words.length && addAt(added) <= dayTime) {
      await addNoteWithSenses(toInput(words[added]!), addAt(added));
      added++;
    }
    const daysAgo = days - d;
    const active = daysAgo <= 12 || (daysAgo !== 13 && daysAgo !== 14 && rand() < 0.82);
    if (!active) continue;
    const partial = daysAgo > 12 && rand() < 0.2;
    let t = dayTime;
    const q = await getStudyQueue({}, t);
    let items = partial ? q.items.slice(0, Math.ceil(q.items.length / 2)) : q.items;
    if (items.length === 0 && daysAgo <= 12) {
      // Nothing due on a streak day: a little extra practice with the soonest-due cards.
      const soon = await db.cards
        .where('[state+due]')
        .between([CardState.Review, -Infinity], [CardState.Review, Infinity])
        .filter((c) => c.deleted_at === null && !c.suspended)
        .limit(4)
        .toArray();
      items = soon.map((c) => ({
        card_id: c.id,
        note_id: c.note_id,
        kind: 'review' as const,
        card: c,
      }));
    }
    if (daysAgo === 1 && !items.some((i) => i.card.card_type === 'cloze')) {
      // Make sure a cloze card is due today too (relearning after a lapse yesterday).
      const cloze = await db.cards
        .where('[state+due]')
        .between([CardState.Review, -Infinity], [CardState.Review, Infinity])
        .filter(
          (c) =>
            c.card_type === 'cloze' && c.unlocked && !items.some((i) => i.note_id === c.note_id),
        )
        .first();
      if (cloze)
        items = [
          ...items,
          { card_id: cloze.id, note_id: cloze.note_id, kind: 'review', card: cloze },
        ];
    }
    for (const item of items) {
      t += 4_000 + Math.floor(rand() * 9_000);
      const r = rand();
      let rating = (r < 0.09 ? 1 : r < 0.22 ? 2 : r < 0.88 ? 3 : 4) as RatingValue;
      // Lapse yesterday's production/cloze cards so today's session has every card type.
      if (daysAgo === 1 && item.card.card_type !== 'recognition') rating = 1;
      await answerCard(
        { card_id: item.card_id, rating, duration_ms: 4_000 + Math.floor(rand() * 9_000) },
        t,
      );
      answers++;
    }
  }
  for (const w of DEMO_WORDS.slice(DEMO_WORDS.length - fresh)) {
    await addNoteWithSenses(toInput(w), Math.max(todayStart, now - 3_600_000));
    added++;
  }
  return { notes: added, answers };
}

/** Synthetic notes for performance checks: each yields 3 cards (recognition, production, cloze). */
export async function seedBulk(cards = 1000, now = Date.now()): Promise<number> {
  const notes = Math.ceil(cards / 3);
  for (let i = 0; i < notes; i++) {
    const term = `word${i}`;
    const sentence = `This sentence uses ${term} in context.`;
    await addNoteWithSenses(
      {
        term,
        senses: [
          {
            meaning_tr: `anlam ${i}`,
            gloss_en: `gloss ${i}`,
            source_sentence: sentence,
            span: findSpan(sentence, term),
          },
        ],
      },
      now - (notes - i) * 1000,
    );
  }
  return notes * 3;
}

/** Empties every local table (dev only). */
export async function resetLocalData(): Promise<void> {
  await Promise.all(db.tables.map((t) => t.clear()));
}
