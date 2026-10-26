package io.github.hsniscan.engapp.widget

import android.content.Intent
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import io.github.hsniscan.engapp.answers.CardReminders

/**
 * The web app's side of the widgets (src/native/widget.ts WidgetBridge, docs/decisions/0048):
 * `refresh()` redraws them after the app wrote widget_state, and a tap on a widget or on the
 * reminder that asks a card arrives as the `routeOpened` event (retained until the web app
 * listens, so a tap that starts the app is not lost while the page loads).
 */
@CapacitorPlugin(name = "WidgetBridge")
class WidgetBridgePlugin : Plugin() {

    @PluginMethod
    fun refresh(call: PluginCall) {
        EngappWidgets.updateAllAsync(context) { call.resolve() }
    }

    override fun handleOnNewIntent(intent: Intent?) {
        super.handleOnNewIntent(intent)
        if (intent == null || intent.getBooleanExtra(CONSUMED, false)) return
        // Reopening from Recents replays the original intent: not a new tap.
        if ((intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return
        val route = intent.getStringExtra(CardReminders.EXTRA_ROUTE) ?: return
        if (!route.startsWith("/") || route.startsWith("//")) return
        intent.putExtra(CONSUMED, true)
        val data = JSObject()
        data.put("route", route)
        notifyListeners("routeOpened", data, true)
    }

    companion object {
        private const val CONSUMED = "io.github.hsniscan.engapp.ROUTE_CONSUMED"
    }
}
