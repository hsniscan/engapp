package io.github.hsniscan.engapp;

/**
 * What to do when the WebView's renderer process is gone (docs/decisions/0064). Android kills
 * the renderer of a background app under memory pressure; without a handler the whole app
 * process is killed with it. Engapp rebuilds the activity (a fresh WebView on the same data)
 * instead, but a renderer that crashes again right after a rebuild is a loop: then the activity
 * is closed. Pure, so it is unit-tested without Android classes.
 */
public final class RendererRecovery {

    public enum Action { RECREATE, FINISH }

    /** Two losses this close together are treated as a crash loop. */
    public static final long LOOP_WINDOW_MS = 30_000;

    private long lastLossAt = Long.MIN_VALUE;

    public synchronized Action onRendererGone(long nowMs) {
        boolean loop = lastLossAt != Long.MIN_VALUE && nowMs - lastLossAt < LOOP_WINDOW_MS;
        lastLossAt = nowMs;
        return loop ? Action.FINISH : Action.RECREATE;
    }
}
