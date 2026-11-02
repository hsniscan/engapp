package io.github.hsniscan.engapp;

/**
 * A photo or screenshot shared with Engapp (ACTION_SEND, image/*) for "Fotoğraftan metin"
 * (docs/decisions/0064). Pure rules, unit-tested without Android classes: which intents count,
 * the file name the copy gets in the app's cache, and the size bound.
 */
public final class SharedImage {

    /** A phone photo is a few MB; the OCR screen downsizes it anyway (features/ocr/image.ts). */
    public static final long MAX_BYTES = 25L * 1024 * 1024;

    /** Folder under the app's cache dir; emptied before every new share. */
    public static final String DIR = "shared-images";

    private SharedImage() {}

    /** True for a single-image share (SEND_MULTIPLE is not declared, so never arrives). */
    public static boolean accepts(String action, String type) {
        return "android.intent.action.SEND".equals(action) && type != null && type.startsWith("image/");
    }

    /** Cache file name for the share `id`; the extension only helps the WebView's MIME guess. */
    public static String fileName(String id, String type) {
        String ext;
        switch (type == null ? "" : type) {
            case "image/png":
                ext = ".png";
                break;
            case "image/webp":
                ext = ".webp";
                break;
            case "image/gif":
                ext = ".gif";
                break;
            case "image/heic":
            case "image/heif":
                ext = ".heic";
                break;
            default:
                ext = ".jpg";
        }
        String safe = id == null ? "image" : id.replaceAll("[^A-Za-z0-9_-]", "");
        if (safe.isEmpty()) safe = "image";
        return safe + ext;
    }
}
