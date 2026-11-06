// The one place with default AI model ids (AGENTS.md rule 5, decision 0060). Every module
// reads its model from the environment (GEMINI_MODEL, CLAUDE_TEXT_MODEL, ...) and falls back
// to the value here; workflows pass a model only when a repository variable sets one. To move
// to a new model, change it here (or set the variable) and nowhere else. Prices per model are
// data of the cost guard and live in image-models.ts.

/** Text tasks on Gemini (GEMINI_MODEL) and its fallback (GEMINI_FALLBACK_MODEL; '' = none). */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
export const DEFAULT_GEMINI_FALLBACK_MODEL = 'gemini-3.5-flash-lite';
/** Pronunciation audio on a miss (GEMINI_TTS_MODEL / GEMINI_TTS_FALLBACK_MODEL). */
export const DEFAULT_GEMINI_TTS_MODEL = 'gemini-3.8-flash-tts';
export const DEFAULT_GEMINI_TTS_FALLBACK_MODEL = 'gemini-3.8-flash-lite-tts';
/**
 * The primary model of every text AI task (word extraction, meanings, themes, mnemonics,
 * contrasts, the weekly report, the daily story, the nightly level job): CLAUDE_TEXT_MODEL.
 * Sonnet since v0.5.3 (owner's choice 2026-11-05, decision 0077); Gemini is the fallback.
 */
export const DEFAULT_CLAUDE_TEXT_MODEL = 'claude-sonnet-5-5';
/** Pictures (CLAUDE_IMAGE_MODEL): Sonnet since 2026-10-24 (owner's choice). */
export const DEFAULT_IMAGE_MODEL = 'claude-sonnet-5-5';
/** Visualizability scores and picture checks (CLAUDE_CHECK_MODEL). */
export const DEFAULT_CHECK_MODEL = 'claude-haiku-5-5';
/** Kelime Bankası review (CLAUDE_WORDBANK_REVIEW_MODEL, decision 0040). */
export const DEFAULT_WORDBANK_REVIEW_MODEL = 'claude-sonnet-5-5';
/** Graded library texts (CLAUDE_GRADED_MODEL, decision 0047). */
export const DEFAULT_GRADED_MODEL = 'claude-sonnet-5-5';

/**
 * Models that run the word-bank review without extended thinking (`between_tools`): a short
 * judgment per meaning, where thinking would double the output cost. Others think adaptively.
 */
export const MODELS_WITHOUT_REVIEW_THINKING: readonly string[] = ['claude-sonnet-5-5'];

/**
 * Models that run the text tasks without extended thinking (`between_tools`, decision 0077):
 * short structured answers, where thinking would add output cost and seconds. Others (a
 * variable may name one) think adaptively at effort low.
 */
export const MODELS_WITHOUT_TEXT_THINKING: readonly string[] = ['claude-sonnet-5-5'];
