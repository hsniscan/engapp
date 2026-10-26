// Saving a text file in the Android app (backup, CSV, error log). docs/decisions/0058.
//
// The WebView ignores `<a download>`, so the web path does nothing there. Here the file goes to
// the phone's public Documents folder (Filesystem plugin); if that is refused (old Android
// without the storage permission), it is written to the app cache and handed to the share
// sheet so the user can save it to Drive or Files. Loaded with import() only in the app.
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export type NativeSaveResult =
  | { ok: true; how: 'documents'; location: string; uri: string }
  | { ok: true; how: 'shared'; location: string; uri: string }
  | { ok: false; cancelled: boolean };

/** The folder name the Files app shows for Directory.Documents. */
export const DOCUMENTS_FOLDER = 'Documents';

function cancelled(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /cancel/i.test(msg);
}

export async function saveNativeFile(
  fileName: string,
  text: string,
  shareTitle: string,
): Promise<NativeSaveResult> {
  try {
    const r = await Filesystem.writeFile({
      path: fileName,
      data: text,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
      recursive: true,
    });
    return { ok: true, how: 'documents', location: `${DOCUMENTS_FOLDER}/${fileName}`, uri: r.uri };
  } catch {
    // Fall through to the share sheet.
  }
  const r = await Filesystem.writeFile({
    path: fileName,
    data: text,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });
  try {
    await Share.share({ title: shareTitle, files: [r.uri], dialogTitle: shareTitle });
    return { ok: true, how: 'shared', location: fileName, uri: r.uri };
  } catch (e) {
    return { ok: false, cancelled: cancelled(e) };
  }
}

/** Opens the share sheet for a file saved earlier (the "Paylaş" action on the toast). */
export async function shareNativeFile(uri: string, title: string): Promise<void> {
  try {
    await Share.share({ title, files: [uri], dialogTitle: title });
  } catch {
    // Cancelled: nothing to do.
  }
}
