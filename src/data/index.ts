// Public data API for the UI. Screens import from '@/data' only.
export { db } from './db';
export { loadLevelData, levelDataNow } from './levelData';
export * from './actions';
export * from './queries';
export * from './examples';
export { addExtraNew, getMoreStudyOverview, MAX_EXTRA_NEW_STEP, type MoreStudyOverview } from './extraStudy';
export {
  getPracticeCards,
  getPracticeSourceCounts,
  loadPracticeCandidates,
  recordPractice,
  type PracticeAnswerInput,
  type PracticeSourceCounts,
} from './practice';
export {
  recomputeAllCards,
  applyRemoteRows,
  exportBackup,
  exportCsv,
  restoreBackup,
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
export { getSettings, ensureSettings, updateSettings, defaultSettings, DEFAULT_SETTINGS, type SettingsPatch } from './settings';
export { rebuildDailyActivity, listDailyActivity } from './dailyActivity';
export { repairDuplicateSenses, repairListEntrySentences } from './repairs';
export { getDeviceId, getCurrentUserId, getMeta, setMeta, META } from './meta';
export { logError, listErrors, clearErrors, ERROR_LOG_LIMIT } from './errorLog';
export { ActionError, type ActionErrorCode } from './errors';
export * from './connected';
export {
  addMorphemeCard,
  clearPairNoteFeedback,
  dismissMorphemeSuggestion,
  getDismissedMorphemes,
  getHiddenPairNotes,
  getUserWordSets,
  loadRefFile,
  setPairNoteFeedback,
  type UserWordSets,
} from './family';
