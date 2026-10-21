export type ActionErrorCode =
  | 'not_found'
  | 'deleted'
  | 'duplicate_term'
  | 'invalid_input'
  | 'already_undone'
  | 'not_undoable'
  | 'invalid_backup';

/** Expected failures of data actions; the UI maps `code` to a tr.json message. */
export class ActionError extends Error {
  readonly code: ActionErrorCode;
  constructor(code: ActionErrorCode, message: string = code) {
    super(message);
    this.name = 'ActionError'; // not 'DataError': Dexie remaps that IndexedDB error name
    this.code = code;
  }
}
