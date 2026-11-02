package io.github.hsniscan.engapp;

import android.os.Bundle;
import android.os.SystemClock;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import io.github.hsniscan.engapp.answers.ReminderAnswersPlugin;
import io.github.hsniscan.engapp.widget.WidgetBridgePlugin;

public class MainActivity extends BridgeActivity {

    /** Splash stays at most this long, even if the page never reports its first frame. */
    private static final long SPLASH_MAX_MS = 2_500;

    /** Process-wide, so a renderer that dies again right after a rebuild is seen as a loop. */
    private static final RendererRecovery RECOVERY = new RendererRecovery();

    private volatile boolean pageVisible = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The system splash stays until the web page has drawn its first frame (docs/decisions/0064),
        // so the user does not see an empty WebView in between. Capped, never stuck.
        long splashUntil = SystemClock.uptimeMillis() + SPLASH_MAX_MS;
        SplashScreen.installSplashScreen(this)
            .setKeepOnScreenCondition(() -> !pageVisible && SystemClock.uptimeMillis() < splashUntil);

        // App-local plugins must be registered before the bridge is created.
        registerPlugin(ShareTargetPlugin.class);
        registerPlugin(TextRecognizerPlugin.class);
        // Home-screen widgets and answers from the reminder (docs/decisions/0048).
        registerPlugin(WidgetBridgePlugin.class);
        registerPlugin(ReminderAnswersPlugin.class);
        bridgeBuilder.addWebViewListener(new WebViewListener() {
            @Override
            public void onPageCommitVisible(WebView view, String url) {
                pageVisible = true;
            }

            /**
             * Android may kill the WebView renderer of a background app to free memory. Unhandled,
             * that kills the whole app; instead the activity is rebuilt with a fresh WebView (all
             * data is in IndexedDB, nothing is lost), or closed if the renderer keeps crashing.
             */
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                if (RECOVERY.onRendererGone(SystemClock.uptimeMillis()) == RendererRecovery.Action.RECREATE) {
                    recreate();
                } else {
                    finish();
                }
                return true;
            }
        });
        super.onCreate(savedInstanceState);
    }
}
