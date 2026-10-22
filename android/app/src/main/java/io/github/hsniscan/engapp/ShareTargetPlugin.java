package io.github.hsniscan.engapp;

import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Delivers "Paylaş → Engapp" shares to the web app as the `shareReceived` event
 * (docs/decisions/0034-share-target.md). BridgeActivity passes the launch intent (cold start)
 * and every later intent (warm start, singleTask) to handleOnNewIntent. The event is retained
 * until the web app adds its listener, so a share that starts the app is not lost while the
 * page loads.
 */
@CapacitorPlugin(name = "ShareTarget")
public class ShareTargetPlugin extends Plugin {

    private static final String CONSUMED = "io.github.hsniscan.engapp.SHARE_CONSUMED";
    private int seq = 0;

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (intent == null || intent.getBooleanExtra(CONSUMED, false)) return;
        // Reopening from Recents replays the original share intent: ignore it.
        if ((intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return;
        SharePayload p = SharePayload.from(
            intent.getAction(),
            intent.getType(),
            intent.getCharSequenceExtra(Intent.EXTRA_TEXT),
            intent.getCharSequenceExtra(Intent.EXTRA_SUBJECT),
            intent.getCharSequenceExtra(Intent.EXTRA_TITLE)
        );
        if (p == null) return;
        // The activity keeps this intent across recreation (e.g. after process death): mark it
        // so the same share is not delivered twice.
        intent.putExtra(CONSUMED, true);
        JSObject data = new JSObject();
        data.put("id", System.currentTimeMillis() + "-" + (++seq));
        data.put("text", p.text);
        data.put("title", p.title);
        notifyListeners("shareReceived", data, true);
    }
}
