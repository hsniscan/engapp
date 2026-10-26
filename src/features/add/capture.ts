// One way out of every capture (v0.5.1, decision 0056): a pasted text, a PDF, an article, a
// photo, a subtitle file, a shared or selected text. The text is always saved first as the
// user's own reading text; "Okuyucuda aç" opens it, "Bu metindeki kelimeleri çıkar" starts the
// word extraction on it and links the job to the text (import_jobs.text_id), so the preview can
// open the text again and nothing the user brought in is lost.
import { createImportJob, getImportJob, getSettings } from '@/data';
import { getText, saveText } from '@/data/texts';
import { chunkText } from '@/domain/chunking';
import { MAX_TEXT_CHARS, type TextKind } from '@/domain/texts';
import type { Id } from '@/domain/types';
import { kickImportQueue } from '@/features/import/queue';
import { MAX_IMPORT_CHARS } from '@/features/import/shared';

export interface CaptureInput {
  kind: Exclude<TextKind, 'graded' | 'story'>;
  title: string;
  body: string;
  /** The article address, or the PDF / subtitle file name. */
  sourceUrl?: string | null;
  /** PDF only: its page count (kept on the extraction's source). */
  pageCount?: number | null;
}

/**
 * A pasted text's title: its first sentence when that is short ("Every morning I walk my
 * dog"), else its first words ("The morning was quiet and…"). It is the reader's heading, so
 * it stays within a line or two on a phone.
 */
export function captureTitle(body: string, max = 60): string {
  const line =
    body
      .split('\n')
      .find((l) => l.trim())
      ?.replace(/\s+/g, ' ')
      .trim() ?? '';
  if (line.length <= max) return line;
  const sentence = /^(.{12,}?)[.!?](\s|$)/.exec(line)?.[1];
  if (sentence && sentence.length <= max) return sentence;
  const cut = line.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), Math.floor(max / 3))).trimEnd()}…`;
}

const keyOf = (input: CaptureInput) => `${input.kind}\u0000${input.body}`;

/** One saved text per captured body and session (a second tap, going back, StrictMode). */
const saved = new Map<string, Promise<Id>>();
const jobs = new Map<string, Promise<string>>();

/** Saves the capture as a reading text (once per session) and returns its id. */
export function saveCapture(input: CaptureInput, fallbackTitle = ''): Promise<Id> {
  const key = keyOf(input);
  const prev = saved.get(key);
  const p = (async () => {
    // The text may have been deleted since (Metinlerim): then it is saved again.
    if (prev) {
      const id = await prev.catch(() => null);
      if (id && (await getText(id))) return id;
    }
    return saveText({
      kind: input.kind,
      title: input.title.trim() || captureTitle(input.body) || fallbackTitle,
      body: input.body.slice(0, MAX_TEXT_CHARS),
      source_url: input.sourceUrl ?? null,
    });
  })();
  saved.set(key, p);
  p.catch(() => saved.delete(key));
  return p;
}

/**
 * Saves the text (when it is not yet) and queues the word extraction on it, linked to the text.
 * Resolves to the import job id; the screen opens /import/:id. Once per text and session.
 */
export function extractCapture(input: CaptureInput, fallbackTitle = ''): Promise<string> {
  const key = keyOf(input);
  const prev = jobs.get(key);
  const p = (async () => {
    if (prev) {
      const id = await prev.catch(() => null);
      if (id && (await getImportJob(id))) return id;
    }
    const textId = await saveCapture(input, fallbackTitle);
    const settings = await getSettings();
    const body = input.body.slice(0, MAX_IMPORT_CHARS);
    const job = await createImportJob({
      kind: input.kind === 'pdf' ? 'pdf' : 'text',
      title: input.title.trim() || captureTitle(body) || fallbackTitle,
      file_name: input.kind === 'pdf' ? (input.sourceUrl ?? null) : null,
      page_count: input.kind === 'pdf' ? (input.pageCount ?? null) : null,
      chunks: chunkText(body),
      level: settings.level,
      text_id: textId,
    });
    kickImportQueue();
    return job.id;
  })();
  jobs.set(key, p);
  p.catch(() => jobs.delete(key));
  return p;
}

/** Tests only: forget what this session saved. */
export function resetCaptureMemo(): void {
  saved.clear();
  jobs.clear();
}
