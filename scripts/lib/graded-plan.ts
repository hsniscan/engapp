// The graded library's planner (decision 0047, plan A.5): the level × topic × slot grid, one
// angle and one text type per slot so the nine texts of a cell differ. Pure: the job
// (graded-jobs.ts) compares the grid with the slots it already has and plans the rest.
//
// First plan: A2, B1, B2, C1 × the ten core topics × 9 = 360 texts. The profile's other
// interests come later (`extendedPerCell`), and a cell can grow (`perCell`) when the owner
// wants more texts each month.

import {
  CORE_TOPIC_KEYS,
  GRADED_LENGTHS,
  GRADED_LEVELS,
  GRADED_TOPIC_KEYS,
  type GradedLevel,
  type GradedTopic,
} from '../../supabase/functions/_shared/graded-contract.ts';

/** What a writer request is built from (stored on the job). */
export interface PlanItem {
  plan_key: string;
  level: GradedLevel;
  topic: GradedTopic;
  slot: number;
  /** What the text is about (English, for the model). */
  angle: string;
  /** Kind of text: story, dialogue, article, … */
  genre: string;
  words: { min: number; max: number };
}

/** A short English description of each topic for the writer. */
export const TOPIC_HINTS: Readonly<Record<GradedTopic, string>> = {
  business: 'business English: work, offices, meetings, small companies, customers, careers',
  technology: 'technology in everyday use: phones, computers, the internet, apps, how things work',
  daily_life: 'everyday life: home, family, friends, shopping, cooking, routines, neighbours',
  travel: 'travel: journeys, transport, hotels, cities, holidays, directions, other countries',
  science: 'science explained simply: nature, space, the human body, experiments, discoveries',
  health: 'health and well-being: sleep, food, exercise, doctors, habits, feelings',
  sports: 'sports and games: playing, training, teams, fans, outdoor activities',
  culture: 'culture: music, films, books, art, festivals, traditions, museums',
  history: 'history: how people lived in the past, old inventions, ancient places, long-ago events',
  news: 'news-style reports about fictional, everyday local events (a town fair, a new library, a lost dog found); never real or recent news',
  education: 'education: school, university, learning languages, teachers, exams, study habits',
  food: 'food and cooking: recipes, markets, restaurants, dishes from different countries',
  nature: 'nature and the environment: animals, plants, weather, parks, the sea, mountains',
  arts: 'the arts: painting, photography, theatre, dance, design, making things by hand',
  literature: 'books and reading: libraries, writing, poems, a reading club, how stories work',
  film: 'films and television: going to the cinema, making a short film, how films are made',
  games: 'games and hobbies: board games, video games, puzzles, collecting, playing with friends',
  politics: 'how public life works, explained neutrally: elections, local councils, laws, voting; no parties, no opinions, no real politicians',
  law: 'everyday law explained neutrally: contracts, rights, rules, courts, a neighbour dispute; no real cases',
};

/** Angles per topic: slot k uses angle k (mod the list). Fictional, timeless situations. */
export const TOPIC_ANGLES: Readonly<Record<GradedTopic, readonly string[]>> = {
  business: [
    'the first day at a new job',
    'planning a team meeting that keeps going wrong',
    'a small café that finds new customers',
    'writing a polite email to a difficult client',
    'a job interview from both sides of the table',
    'working from home for a week',
    'a young person starts a tiny online shop',
    'a mistake in an order and how the team fixes it',
    'a business trip to another city',
  ],
  technology: [
    'a grandmother learns to make video calls',
    'how a smartphone battery works',
    'a family tries one day without screens',
    'choosing a good password',
    'a robot vacuum cleaner with a mind of its own',
    'how maps on a phone find the way',
    'a student builds a simple website',
    'the history of the computer mouse',
    'fixing a slow laptop',
  ],
  daily_life: [
    'a busy Monday morning in a big family',
    'moving into a new flat',
    'a neighbour who needs help',
    'cooking dinner for friends for the first time',
    'a lost key and a long evening',
    'a weekend market in a small town',
    'learning to live with a new pet',
    'a birthday surprise that almost fails',
    'saving money for something special',
  ],
  travel: [
    'a missed train and an unexpected day in a new town',
    'packing for a long trip',
    'asking for directions in a foreign city',
    'a night in a strange old hotel',
    'travelling by bicycle along a river',
    'a lost suitcase at the airport',
    'a homestay with a family abroad',
    'a mountain village with no cars',
    'the best and worst souvenirs',
  ],
  science: [
    'why the sky is blue',
    'how bees make honey',
    'a simple experiment in the kitchen',
    'what happens when we sleep',
    'how volcanoes form',
    'the life of a star',
    'why some animals sleep all winter',
    'how vaccines train the body',
    'water: from the cloud to the tap',
  ],
  health: [
    'starting to walk every day',
    'why breakfast matters (or does not)',
    'a visit to the dentist',
    'learning to manage stress before exams',
    'drinking enough water',
    'a cold that will not go away',
    'the benefits of a good night’s sleep',
    'cooking healthy food on a small budget',
    'taking a break from work',
  ],
  sports: [
    'a first running race',
    'a small football team with big dreams',
    'learning to swim as an adult',
    'a day at a tennis match',
    'why people climb mountains',
    'a coach who changes a team',
    'yoga in the park',
    'the rules of a simple game',
    'a fan who travels to every match',
  ],
  culture: [
    'a music festival in summer',
    'a museum at night',
    'a traditional wedding',
    'a street artist and a wall',
    'a family recipe passed down',
    'learning to play the guitar',
    'a book club that never reads the book',
    'a festival of lights',
    'old songs and new listeners',
  ],
  history: [
    'how people kept food cold before fridges',
    'life in an ancient city',
    'the first postal services',
    'how clocks changed daily life',
    'the story of paper',
    'old trade routes and the goods they carried',
    'a lighthouse keeper long ago',
    'the invention of the bicycle',
    'how bridges were built in the past',
  ],
  news: [
    'a town opens a new library',
    'a lost dog finds its way home',
    'a school wins a science competition',
    'a heavy snowfall closes the roads',
    'a local bakery celebrates fifty years',
    'volunteers clean the beach',
    'a new bus line connects two villages',
    'a park gets a community garden',
    'a young chess player beats the champion',
  ],
  education: ['a first day at university', 'learning a language with an app', 'a teacher who loves questions'],
  food: ['a dish from another country', 'a farmer’s market', 'a cooking class goes wrong'],
  nature: ['a walk in the forest', 'birds in the city', 'a storm at sea'],
  arts: ['a photography walk', 'making pottery', 'a small theatre group'],
  literature: ['a library in a small village', 'writing a first poem', 'a second-hand bookshop'],
  film: ['making a short film with friends', 'a night at an old cinema', 'how film sound is made'],
  games: ['a board game night', 'a puzzle that took a year', 'a chess club for beginners'],
  politics: ['how a town council decides', 'what happens on election day', 'how a new rule is made'],
  law: ['renting a flat: reading the contract', 'a dispute between neighbours', 'what a jury does'],
};

/** Kinds of text, rotated over the slots of a cell. */
export const GENRES = [
  'short story',
  'magazine article',
  'dialogue',
  'personal blog post',
  'explainer',
  'email or letter',
  'interview',
  'diary entry',
  'practical guide',
] as const;

export const planKeyOf = (level: string, topic: string, slot: number) => `${level}|${topic}|${slot}`;

export function planItem(level: GradedLevel, topic: GradedTopic, slot: number): PlanItem {
  const angles = TOPIC_ANGLES[topic];
  const li = GRADED_LEVELS.indexOf(level);
  const ti = GRADED_TOPIC_KEYS.indexOf(topic);
  const round = Math.floor(slot / angles.length);
  return {
    plan_key: planKeyOf(level, topic, slot),
    level,
    topic,
    slot,
    angle: angles[slot % angles.length]! + (round > 0 ? ` (a new text, version ${round + 1})` : ''),
    genre: GENRES[(slot + li * 2 + ti + round * 4) % GENRES.length]!,
    words: GRADED_LENGTHS[level],
  };
}

export interface PlanTargets {
  levels: readonly GradedLevel[];
  /** Texts per cell of each core topic (first plan: 9). */
  perCell: number;
  /** Texts per cell of each other profile topic (first plan: 0). */
  extendedPerCell: number;
}

export const FIRST_PLAN: PlanTargets = { levels: GRADED_LEVELS, perCell: 9, extendedPerCell: 0 };

/** A slot the job already has (graded_jobs), by its state. */
export interface ExistingSlot {
  plan_key: string;
  level: string;
  topic: string;
  slot: number;
  state: 'queued' | 'submitted' | 'done' | 'failed';
}

/**
 * The slots still to plan: for every cell, enough new slots that the cell's live slots (all
 * but the failed ones) reach its target. A failed slot is replaced by the next free slot
 * number, but a cell never uses more than twice its target (a topic the model keeps failing
 * stops costing money). Stable order: level, topic, slot.
 */
export function planMissing(targets: PlanTargets, existing: readonly ExistingSlot[]): PlanItem[] {
  const byCell = new Map<string, ExistingSlot[]>();
  for (const e of existing) {
    const k = `${e.level}|${e.topic}`;
    byCell.set(k, [...(byCell.get(k) ?? []), e]);
  }
  const out: PlanItem[] = [];
  for (const level of targets.levels) {
    for (const topic of GRADED_TOPIC_KEYS) {
      const target = CORE_TOPIC_KEYS.includes(topic) ? targets.perCell : targets.extendedPerCell;
      if (target <= 0) continue;
      const slots = byCell.get(`${level}|${topic}`) ?? [];
      const used = new Set(slots.map((s) => s.slot));
      let live = slots.filter((s) => s.state !== 'failed').length;
      for (let slot = 0; live < target && slot < target * 2; slot++) {
        if (used.has(slot)) continue;
        out.push(planItem(level, topic, slot));
        live++;
      }
    }
  }
  return out;
}
