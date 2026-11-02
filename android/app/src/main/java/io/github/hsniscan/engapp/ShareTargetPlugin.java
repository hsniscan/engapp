package io.github.hsniscan.engapp;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import androidx.core.content.IntentCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Delivers "Paylaş → Engapp" shares to the web app as the `shareReceived` event
 * (docs/decisions/0034-share-target.md). BridgeActivity passes the launch intent (cold start)
 * and every later intent (warm start, singleTask) to handleOnNewIntent. The event is retained
 * until the web app adds its listener, so a share that starts the app is not lost while the
 * page loads.
 *
 * The same plugin serves "Engapp" in the text-selection menu (docs/decisions/0046): in
 * QuickCaptureActivity an ACTION_PROCESS_TEXT intent becomes `processTextReceived`; the sheet
 * closes with finishQuick() and hands over to the main app with openInApp(), which MainActivity
 * receives as `openPathReceived` (an address) or as an ordinary share (a text).
 *
 * A shared photo or screenshot (image/*, docs/decisions/0064) is copied into the app's cache and
 * delivered as `imageShared` with the copy's path; the web app opens it in "Fotoğraftan metin".
 */
@CapacitorPlugin(name = "ShareTarget")
public class ShareTargetPlugin extends Plugin {

    private static final String CONSUMED = "io.github.hsniscan.engapp.SHARE_CONSUMED";
    private int seq = 0;
    /** Copies shared images off the UI thread (a content URI may be slow, e.g. a cloud photo). */
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());

    private String nextId() {
        return System.currentTimeMillis() + "-" + (++seq);
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (intent == null || intent.getBooleanExtra(CONSUMED, false)) return;
        // Reopening from Recents replays the original share intent: ignore it.
        if ((intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return;
        if (deliverProcessText(intent) || deliverOpenPath(intent) || deliverImage(intent)) return;
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
        data.put("id", nextId());
        data.put("text", p.text);
        data.put("title", p.title);
        notifyListeners("shareReceived", data, true);
    }

    /** ACTION_PROCESS_TEXT (only QuickCaptureActivity has that intent filter). */
    private boolean deliverProcessText(Intent intent) {
        QuickIntents q = QuickIntents.processText(
            intent.getAction(),
            intent.getType(),
            intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT),
            intent.getBooleanExtra(Intent.EXTRA_PROCESS_TEXT_READONLY, false)
        );
        if (q == null) return QuickIntents.ACTION_PROCESS_TEXT.equals(intent.getAction());
        intent.putExtra(CONSUMED, true);
        JSObject data = new JSObject();
        data.put("id", nextId());
        data.put("text", q.text);
        data.put("readonly", q.readonly);
        notifyListeners("processTextReceived", data, true);
        return true;
    }

    /** "Paylaş → Engapp" with a photo (MainActivity only has that intent filter). */
    private boolean deliverImage(Intent intent) {
        if (!SharedImage.accepts(intent.getAction(), intent.getType())) return false;
        Uri uri = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri.class);
        if (uri == null) return true;
        intent.putExtra(CONSUMED, true);
        String id = nextId();
        String type = intent.getType();
        File dir = new File(getContext().getCacheDir(), SharedImage.DIR);
        io.execute(() -> {
            File out = copyImage(uri, dir, SharedImage.fileName(id, type));
            if (out == null) return;
            JSObject data = new JSObject();
            data.put("id", id);
            data.put("path", out.getAbsolutePath());
            data.put("mimeType", type);
            main.post(() -> notifyListeners("imageShared", data, true));
        });
        return true;
    }

    /** Copy into the cache (only the newest share is kept); null if unreadable or too large. */
    private File copyImage(Uri uri, File dir, String name) {
        if (!dir.isDirectory() && !dir.mkdirs()) return null;
        File[] old = dir.listFiles();
        if (old != null) for (File f : old) f.delete();
        File out = new File(dir, name);
        try (InputStream in = getContext().getContentResolver().openInputStream(uri);
             OutputStream os = new FileOutputStream(out)) {
            if (in == null) return null;
            byte[] buf = new byte[64 * 1024];
            long total = 0;
            int n;
            while ((n = in.read(buf)) != -1) {
                total += n;
                if (total > SharedImage.MAX_BYTES) throw new java.io.IOException("Shared image too large");
                os.write(buf, 0, n);
            }
            return out;
        } catch (Exception e) {
            out.delete();
            return null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        io.shutdown();
        super.handleOnDestroy();
    }

    /** The quick sheet's "Okuyucuda aç" / "Anlamını kendim yazayım" (MainActivity). */
    private boolean deliverOpenPath(Intent intent) {
        if (!QuickIntents.ACTION_OPEN_PATH.equals(intent.getAction())) return false;
        String path = intent.getStringExtra(QuickIntents.EXTRA_PATH);
        if (!QuickIntents.isOpenablePath(path)) return true;
        intent.putExtra(CONSUMED, true);
        JSObject data = new JSObject();
        data.put("id", nextId());
        data.put("path", path);
        notifyListeners("openPathReceived", data, true);
        return true;
    }

    private boolean inQuickSheet() {
        return getActivity() instanceof QuickCaptureActivity;
    }

    @PluginMethod
    public void host(PluginCall call) {
        JSObject res = new JSObject();
        res.put("quick", inQuickSheet());
        call.resolve(res);
    }

    /**
     * Closes the quick sheet back to the calling app. Never returns a result: the selection is
     * only read (EXTRA_PROCESS_TEXT is never sent back, read-only field or not).
     */
    @PluginMethod
    public void finishQuick(PluginCall call) {
        Activity activity = getActivity();
        if (!(activity instanceof QuickCaptureActivity)) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            activity.setResult(Activity.RESULT_CANCELED);
            activity.finish();
        });
        call.resolve();
    }

    /** From the quick sheet: open the main app on an address or share a text into it. */
    @PluginMethod
    public void openInApp(PluginCall call) {
        Activity activity = getActivity();
        String path = call.getString("path");
        String share = QuickIntents.handoverText(call.getString("shareText"));
        Intent intent = new Intent(activity, MainActivity.class);
        if (share != null) {
            intent.setAction(Intent.ACTION_SEND);
            intent.setType("text/plain");
            intent.putExtra(Intent.EXTRA_TEXT, share);
        } else if (QuickIntents.isOpenablePath(path)) {
            intent.setAction(QuickIntents.ACTION_OPEN_PATH);
            intent.putExtra(QuickIntents.EXTRA_PATH, path);
        } else {
            call.reject("Nothing to open");
            return;
        }
        // MainActivity is singleTask in the app's own task: a running app gets onNewIntent.
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        activity.runOnUiThread(() -> {
            activity.startActivity(intent);
            if (activity instanceof QuickCaptureActivity) {
                activity.setResult(Activity.RESULT_CANCELED);
                activity.finish();
            }
        });
        call.resolve();
    }
}
