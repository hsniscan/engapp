package io.github.hsniscan.engapp;

import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/**
 * "Engapp" in the text-selection menu of any app (ACTION_PROCESS_TEXT, docs/decisions/0046).
 *
 * A translucent activity with its own Capacitor bridge on /quick: the calling app stays visible
 * behind the sheet, the main app is not opened, and finish() returns to the caller. It has its
 * own task affinity and is excluded from Recents, so a caller that starts it in a new task
 * never brings the main app's task forward either. The WebView shares the app's origin
 * (https://localhost), so the card it saves lands in the same IndexedDB as the main app's.
 *
 * Cold start: BridgeActivity hands the launch intent to the plugins after the bridge is built
 * (ShareTargetPlugin retains `processTextReceived` until the page listens). A second selection
 * while the sheet is on top arrives through onNewIntent (singleTop) the same way.
 */
public class QuickCaptureActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ShareTargetPlugin.class);
        config = QuickConfig.load(this);
        super.onCreate(savedInstanceState);
        // BridgeActivity applies the app's opaque theme; the window and the WebView stay clear.
        getWindow().setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().setBackgroundColor(Color.TRANSPARENT);
        }
        noTransition();
    }

    /**
     * BridgeActivity.onCreate calls setTheme(AppTheme.NoActionBar) (opaque, with the splash
     * canvas as window background). Keep the translucent theme of the manifest instead.
     */
    @Override
    public void setTheme(int resid) {
        super.setTheme(R.style.AppTheme_QuickCapture);
    }

    @Override
    public void finish() {
        super.finish();
        noTransition();
    }

    /** The sheet animates itself (CSS); the window appears and leaves without a transition. */
    @SuppressWarnings("deprecation")
    private void noTransition() {
        overridePendingTransition(0, 0);
    }
}
