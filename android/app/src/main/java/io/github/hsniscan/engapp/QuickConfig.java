package io.github.hsniscan.engapp;

import android.content.Context;
import com.getcapacitor.CapConfig;
import com.getcapacitor.Logger;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/**
 * The Capacitor configuration of QuickCaptureActivity's WebView (docs/decisions/0046): the
 * app's own capacitor.config.json (same scheme and host, so the same IndexedDB as the main app)
 * with the start address /quick and a transparent WebView background.
 *
 * CapConfig has no public setter for the start path on a loaded config, so the bundled file is
 * copied with `server.appStartPath` set and loaded with the public loadFromFile. On any error
 * this returns null and the bridge uses the default configuration (the page then still opens:
 * the selection event navigates to /quick?text=…).
 */
final class QuickConfig {

    static final String START_PATH = "/quick";

    private QuickConfig() {}

    static CapConfig load(Context context) {
        try {
            JSONObject json = new JSONObject(readAsset(context, "capacitor.config.json"));
            JSONObject server = json.optJSONObject("server");
            if (server == null) server = new JSONObject();
            server.put("appStartPath", START_PATH);
            json.put("server", server);
            JSONObject android = json.optJSONObject("android");
            if (android == null) android = new JSONObject();
            android.put("backgroundColor", "#00000000");
            json.put("android", android);

            File dir = new File(context.getCacheDir(), "quick-capture");
            if (!dir.isDirectory() && !dir.mkdirs()) return null;
            File file = new File(dir, "capacitor.config.json");
            byte[] bytes = json.toString().getBytes(StandardCharsets.UTF_8);
            try (FileOutputStream out = new FileOutputStream(file, false)) {
                out.write(bytes);
            }
            return CapConfig.loadFromFile(context, dir.getAbsolutePath());
        } catch (Exception e) {
            Logger.error("QuickCapture: config", e);
            return null;
        }
    }

    private static String readAsset(Context context, String name) throws Exception {
        try (InputStream in = context.getAssets().open(name); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString("UTF-8");
        }
    }
}
