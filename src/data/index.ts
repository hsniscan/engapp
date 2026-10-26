// Public data API for the UI. Screens import from '@/data' only.
export { db } from './db';
export { wipeLocalDatabase } from './wipe';
export { loadLevelData, levelDataNow } from './levelData';
export * from './actions';
export * from './queries';
export * from './wordStages';
export * from './examples';
export * from './mnemonics';
export * from './images';
export {
  imageCardsSignature,
  imageCardsWithoutPicture,
  reconcileImageCards,
  setImageCardsEnabled,
  type ReconcileOptions,
} from './imageCards';
export {
  computeWeeklySummary,
  deferReportDraft,
  draftExpired,
  dueReportDrafts,
  ensureWeeklyReport,
  finalizeReportDraft,
  getGoalsView,
  getReportNotice,
  listReportDrafts,
  listWeeklyReports,
  markReportSeen,
  REPORT_COMMENT_WAIT_MS,
  REPORT_MAX_ATTEMPTS,
  reportSeenKey,
  setGoals,
  updateGoals,
  type EnsureReportOutcome,
  type GoalsView,
  type ReportListItem,
} from './weeklyReport';
export * from './leech';
export * from './contrast';
export { addExtraNew, getMoreStudyOverview, MAX_EXTRA_NEW_STEP, type MoreStudyOverview } from './extraStudy';
export {
  computeWorkload,
  dismissLoadWarning,
  endVacation,
  getLoadStatus,
  getWorkloadInput,
  isLoadWarningSnoozed,
  setVacation,
  type LoadStatus,
  type LoadToday,
  type WorkloadInput,
  type WorkloadView,
} from './load';
export {
  countDeckFilter,
  createDeck,
  deleteDeck,
  deleteTag,
  getDeckNoteIds,
  getDeckSummaries,
  listDecks,
  listTags,
  loadDeckFacts,
  moveDeck,
  renameTag,
  setNoteTags,
  updateDeck,
  type BulkTagResult,
  type DeckInput,
  type DeckSummary,
} from './decks';
export {
  applyThemePreview,
  discardThemePreview,
  getThemePreview,
  getThemeSource,
  saveThemePreview,
  updateThemePreview,
  type ApplyThemesResult,
  type ThemeSource,
} from './themes';
export {
  getHardPracticeCount,
  getPracticeCards,
  getPracticeSourceCounts,
  loadPracticeCandidates,
  recordPractice,
  type PracticeAnswerInput,
  type PracticeSourceCounts,
} from './practice';
export {
  recomputeAllCards,
  backfillLearningModel,
  stageRuleNoticePending,
  markStageRuleNoticeSeen,
  applyRemoteRows,
  exportBackup,
  recordBackup,
  exportCsv,
  restoreBackup,
  RESTORE_CHUNK,
  runIntegrityCheck,
  repairIntegrity,
  adoptGuestData,
  resetStudyHistory,
  RESET_CHUNK_NOTES,
  type ResetHistoryResult,
  type RemoteBatch,
  type ApplyRemoteResult,
  type RestoreMode,
  type RestoreResult,
  type RepairResult,
} from './maintenance';
export { compactOutbox, compactGuestOutbox } from './outbox';
export { isRestoreRunning, subscribeRestoreRunning } from './restoreState';
export { getSettings, ensureSettings, updateSettings, defaultSettings, DEFAULT_SETTINGS, type SettingsPatch } from './settings';
// v0.5 İP1 reader (decision 0043).
export { readingDifficultyOf } from './settings';
export {
  deleteText,
  getText,
  lastUnfinishedText,
  listTexts,
  saveReadingProgress,
  saveText,
  setTextFeedback,
  setTextFinished,
} from './texts';
export { getEncounterSummary, recordReaderEncounters } from './encounters';
export {
  loadKnowledge,
  loadReaderKnowledge,
  readerKnowledgeSignature,
  type Knowledge,
  type ReaderKnowledge,
} from './knowledge';
export { lookupReaderWord, type ReaderMeaning, type ReaderWordInfo } from './readerLookup';
export { rebuildDailyActivity, listDailyActivity } from './dailyActivity';
export {
  adoptFsrsParams,
  countOptimizerReviews,
  loadOptimizerLogs,
  markFsrsOptRun,
  revertFsrsParams,
  type ReviewCounts,
} from './fsrsOpt';
export { repairDuplicateSenses, repairListEntrySentences } from './repairs';
export { getDeviceId, getCurrentUserId, getMeta, setMeta, META } from './meta';
export { PULL_BACKFILL_KEY } from './backfill';
export { logError, listErrors, clearErrors, ERROR_LOG_LIMIT } from './errorLog';
export { ActionError, type ActionErrorCode } from './errors';
export * from './connected';
export {
  addMorphemeCard,
  clearPairNoteFeedback,
  dismissMorphemeSuggestion,
  getDismissedMorphemes,
  getFoundFalseFriends,
  getHiddenPairNotes,
  pairNoteFeedbackIds,
  getUserWordSets,
  loadRefFile,
  setPairNoteFeedback,
  type PairNoteVerdict,
  type UserWordSets,
} from './family';
export {
  dismissInterestPrompt,
  getOrderedContexts,
  getTopicProfile,
  loadFeedbackSignals,
  saveInterests,
  setInterest,
  setSourceTopics,
  setTopicMuted,
  type TopicProfile,
} from './profile';
export {
  ANKI_CHUNK_NOTES,
  ankiEnrichResumeAt,
  applyAnkiEnrichResult,
  getAnkiImport,
  importAnkiPlan,
  listAnkiImports,
  nextAnkiEnrichItems,
  nextAnkiEnrichWake,
  pauseAnkiEnrich,
  startAnkiEnrich,
  type AnkiEnrichItem,
  type AnkiEnrichOutcome,
  type AnkiImportProgress,
  type AnkiImportResult,
} from './anki';
export { getKnownTermKeys, listKnownTerms, markKnown, unmarkKnown } from './knownTerms';
export {
  addFromWordBank,
  applyWordBankPage,
  bankNoteInput,
  countWordBank,
  getOwnedTerms,
  getWordBankCursor,
  getWordBankSyncedAt,
  listWordBank,
  markWordBankSynced,
  WORD_BANK_META,
  type BankAddResult,
} from './wordBank';
export {
  BAND_SIZES,
  countOutsideWords,
  dismissLevelChange,
  getLevelOverview,
  listLevelTests,
  runWeeklyLevelUpdate,
  saveLevelTest,
  undoLevelChange,
  applyTestLevel,
  type LevelOverview,
  type SaveLevelTestInput,
} from './levelModel';
export { getChoiceCandidates } from './clozeChoices';
export * from './smart';
export * from './streakFreeze';
