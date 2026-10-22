package io.github.hsniscan.engapp;

/**
 * The text another app shared with Engapp (ACTION_SEND, text/plain), reduced to plain strings
 * so it can be unit-tested without Android classes. Which screen opens is decided in the web
 * app (src/features/share/route.ts); this only extracts and bounds the values.
 */
public final class SharePayload {

    /** Same bound as one text import (src/features/import/shared.ts MAX_IMPORT_CHARS). */
    public static final int MAX_TEXT_CHARS = 300_000;
    public static final int MAX_TITLE_CHARS = 500;

    public final String text;
    /** EXTRA_SUBJECT or EXTRA_TITLE: browsers put the page title here when sharing a link. */
    public final String title;

    private SharePayload(String text, String title) {
        this.text = text;
        this.title = title;
    }

    /** Null unless the intent is a text share with something in it. */
    public static SharePayload from(String action, String type, CharSequence text, CharSequence subject, CharSequence title) {
        if (!"android.intent.action.SEND".equals(action)) return null;
        if (type == null || !type.startsWith("text/")) return null;
        String t = clean(text, MAX_TEXT_CHARS);
        String s = clean(subject != null ? subject : title, MAX_TITLE_CHARS);
        if (t.isEmpty() && s.isEmpty()) return null;
        return new SharePayload(t, s);
    }

    private static String clean(CharSequence value, int max) {
        if (value == null) return "";
        String s = value.toString().trim();
        if (s.length() > max) s = s.substring(0, max);
        return s;
    }
}
