// Representative model answers for the report-v1 prompt (ai-report, v0.3 İP7), written by hand
// in the shape the prompt asks for (decision 0027). No test calls the real API: the free Gemini
// quota is shared with production.

import type { ReportRequest } from '../report-contracts.ts';

/** A usual week: 5 active days, the weakest category C1, focus practice_weakest. */
export const REPORT_REQUEST: ReportRequest = {
  week: '2026-10-12',
  active_days: 5,
  reviews: 212,
  minutes: 64,
  new_learned: 18,
  retention_pct: 85,
  groups_days: 7,
  strongest: { dimension: 'topic', key: 'travel', rate_pct: 95 },
  weakest: { dimension: 'level', key: 'C1', rate_pct: 70 },
  streak_days: 12,
  goals: [{ key: 'week_active_days', target: 6, value: 5 }],
  focus: 'practice_weakest',
};

/** A good answer: 4 sentences, every number from the request. */
export const REPORT_GOOD = {
  sentences: [
    'Bu hafta 5 gün çalıştın ve 18 yeni kelimeyi öğrendin, güzel bir tempo.',
    'Seyahat konulu kelimeleri çok iyi hatırlıyorsun, %95 ile en güçlü alanın bu.',
    'C1 seviyesindeki kelimeler biraz daha zorluyor; bu çok doğal.',
    'Bu hafta kaçırdığın C1 kelimeleriyle kısa bir pratik turu yaparsan fark hemen görünür.',
  ],
};

/**
 * Every sentence but two breaks a rule: a computed number (the model "added up" 5 + 12), a
 * number word, a made-up percentage, English, a link, an emoji.
 */
export const REPORT_WRONG_NUMBERS = {
  sentences: [
    'Bu hafta 5 gün çalıştın, serin de 12 güne ulaştı.',
    'Toplam 17 gün eder, harika gidiyorsun.',
    'Yedi günün beşinde tekrar yaptın.',
    'Hatırlama oranın geçen haftaya göre %7 arttı.',
    'You did a great job this week with your words.',
    'Ayrıntılar için https://example.com adresine bakabilirsin.',
    'Harika bir hafta geçirdin 🎉 böyle devam et.',
    'C1 kelimeleriyle kısa bir pratik turu iyi gelir.',
  ],
};

/** Nothing usable: only one clean sentence. */
export const REPORT_TOO_FEW = {
  sentences: ['Bu hafta tam 300 tekrar yaptın.', 'Çok iyi gidiyorsun.'],
};
