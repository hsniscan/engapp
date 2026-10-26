// A recorded-style story-v1 answer (invented text, no live call) and its request.

export const STORY_TARGETS = ['decide', 'journey', 'borrow', 'nervous', 'recipe', 'improve'];

export const STORY_REQUEST = {
  level: 'B1',
  difficulty: 'dengeli',
  interests: ['food', 'travel'],
  target_lemmas: STORY_TARGETS,
};

export const GOOD_STORY = {
  title: 'The Sunday Cake',
  paragraphs: [
    'Mira had never cooked for anyone before. When her grandmother invited the whole family for Sunday lunch, Mira decided to bring a cake. She felt nervous, because her last cake had fallen flat in the middle and her brother still laughed about it.',
    "On Saturday she borrowed an old recipe book from her neighbour, Mr Okafor. The pages were yellow and soft, and someone had written small notes in the corners. One note said: 'Less sugar, more lemon.' Mira followed it carefully and tasted the mix twice.",
    "The journey to her grandmother's village took two hours by bus. Mira held the cake box on her knees the whole way and did not sleep. At every stop she checked that the top was still in one piece.",
    'At lunch everyone asked for a second piece. Her brother said nothing for a long time, then asked for the recipe. Mira smiled. She knew her cooking could still improve, but today it was good enough, and that felt wonderful.',
  ],
  used_words: ['decide', 'journey', 'borrow', 'nervous', 'recipe', 'improve'],
  questions: [
    {
      question: 'Why did Mira feel nervous?',
      options: ['Her last cake had gone wrong.', 'She was late for the bus.', 'She did not like cake.'],
      answer_index: 0,
    },
    {
      question: 'Where did the recipe come from?',
      options: ['A shop in the village', 'A book from her neighbour', "Her brother's phone"],
      answer_index: 1,
    },
    {
      question: 'What did her brother ask for at lunch?',
      options: ['A cup of tea', 'The bus timetable', 'The recipe'],
      answer_index: 2,
    },
  ],
  glosses: [
    { word: 'decide', meaning_tr: 'karar vermek' },
    { word: 'journey', meaning_tr: 'yolculuk' },
    { word: 'borrow', meaning_tr: 'ödünç almak' },
    { word: 'nervous', meaning_tr: 'gergin' },
    { word: 'recipe', meaning_tr: 'tarif' },
    { word: 'improve', meaning_tr: 'gelişmek' },
    { word: 'neighbour', meaning_tr: 'komşu' },
    { word: 'unicorn', meaning_tr: 'tek boynuzlu at' },
  ],
};
