package io.github.hsniscan.engapp;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import io.github.hsniscan.engapp.answers.ReminderAnswersPlugin;
import io.github.hsniscan.engapp.widget.WidgetBridgePlugin;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-local plugins must be registered before the bridge is created.
        registerPlugin(ShareTargetPlugin.class);
        registerPlugin(TextRecognizerPlugin.class);
        // Home-screen widgets and answers from the reminder (docs/decisions/0048).
        registerPlugin(WidgetBridgePlugin.class);
        registerPlugin(ReminderAnswersPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
