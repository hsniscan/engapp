package io.github.hsniscan.engapp;

import java.util.regex.Pattern;

/**
 * "Engapp" in the text-selection menu (docs/decisions/0046-quick-capture.md), reduced to plain
 * strings so it can be unit-tested without Android classes: the selection of an
 * ACTION_PROCESS_TEXT intent, and the in-app addresses the quick sheet may hand to the main app.
 * What the selection becomes is decided in the web app (src/features/quick/route.ts).
 */
public final class QuickIntents {

    public static final String ACTION_PROCESS_TEXT = "android.intent.action.PROCESS_TEXT";

    /** The quick sheet asks the main app to open an address (explicit intent, MainActivity). */
    public static final String ACTION_OPEN_PATH = "io.github.hsniscan.engapp.OPEN_PATH";
    public static final String EXTRA_PATH = "io.github.hsniscan.engapp.PATH";

    /**
     * A text handed from the quick sheet to "Paylaş → Engapp" travels in an intent extra: kept
     * well under the 1 MB binder limit (UTF-16, plus the rest of the intent).
     */
    public static final int MAX_HANDOVER_CHARS = 100_000;

    // Mirrors isOpenablePath in src/features/quick/route.ts.
    private static final Pattern READER = Pattern.compile("^/oku/[A-Za-z0-9_-]{1,64}$");
    private static final Pattern ADD = Pattern.compile("^/add\\?term=[^&#\\s]{1,500}$");

    public final String text;
    /** EXTRA_PROCESS_TEXT_READONLY: informational only, Engapp never returns text. */
    public final boolean readonly;

    private QuickIntents(String text, boolean readonly) {
        this.text = text;
        this.readonly = readonly;
    }

    /** Null unless the intent is a text selection with something in it. */
    public static QuickIntents processText(String action, String type, CharSequence text, boolean readonly) {
        if (!ACTION_PROCESS_TEXT.equals(action)) return null;
        if (type != null && !type.startsWith("text/")) return null;
        if (text == null) return null;
        String t = text.toString().trim();
        if (t.isEmpty()) return null;
        if (t.length() > SharePayload.MAX_TEXT_CHARS) t = t.substring(0, SharePayload.MAX_TEXT_CHARS);
        return new QuickIntents(t, readonly);
    }

    /** The only addresses the main app opens from ACTION_OPEN_PATH (MainActivity is exported). */
    public static boolean isOpenablePath(String path) {
        if (path == null || path.length() > 600) return false;
        return READER.matcher(path).matches() || ADD.matcher(path).matches();
    }

    /** A text for the share flow, bounded for the intent extra; null when there is nothing. */
    public static String handoverText(String text) {
        if (text == null) return null;
        String t = text.trim();
        if (t.isEmpty()) return null;
        return t.length() > MAX_HANDOVER_CHARS ? t.substring(0, MAX_HANDOVER_CHARS) : t;
    }
}
