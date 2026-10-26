package io.github.hsniscan.engapp.widget

import android.content.Context
import android.content.Intent
import androidx.glance.appwidget.updateAll
import io.github.hsniscan.engapp.MainActivity
import io.github.hsniscan.engapp.answers.CardReminders
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Shared parts of the two widgets (docs/decisions/0048): reading the state the web app wrote,
 * the single reveal state of the word widget, the redraw and the taps that open the app.
 */
object EngappWidgets {
    /** @capacitor/preferences stores in this SharedPreferences group (its default). */
    private const val CAPACITOR_STORAGE = "CapacitorStorage"
    /** src/domain/widget.ts WIDGET_STATE_KEY */
    private const val STATE_KEY = "widget_state"
    private const val OWN_PREFS = "engapp_widget"
    private const val REVEALED_KEY = "revealed"

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    fun load(c: Context): WidgetView {
        val state = c.getSharedPreferences(CAPACITOR_STORAGE, Context.MODE_PRIVATE).getString(STATE_KEY, null)
        val revealed = c.getSharedPreferences(OWN_PREFS, Context.MODE_PRIVATE).getString(REVEALED_KEY, null)
        return WidgetView.from(state, CardReminders.readQueue(c), revealed, System.currentTimeMillis())
    }

    /** At most one reveal state is ever stored: the key of the word that is turned over. */
    fun setRevealed(c: Context, key: String?) {
        val e = c.getSharedPreferences(OWN_PREFS, Context.MODE_PRIVATE).edit()
        if (key == null) e.remove(REVEALED_KEY) else e.putString(REVEALED_KEY, key)
        e.commit()
    }

    suspend fun updateAll(c: Context) {
        DueWidget().updateAll(c)
        WordWidget().updateAll(c)
    }

    /** For callers outside a coroutine (plugin call, broadcast receiver); [done] runs after. */
    fun updateAllAsync(c: Context, done: () -> Unit = {}) {
        val app = c.applicationContext
        scope.launch {
            try {
                updateAll(app)
            } catch (e: Exception) {
                // a widget that cannot redraw now redraws on its next 30-minute update
            } finally {
                done()
            }
        }
    }

    /** Opens the app on an in-app route (handled by WidgetBridgePlugin → the web router). */
    fun openIntent(c: Context, route: String): Intent =
        Intent(c, MainActivity::class.java)
            // A distinct action per route keeps two widget PendingIntents from replacing each other.
            .setAction("io.github.hsniscan.engapp.OPEN:$route")
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra(CardReminders.EXTRA_ROUTE, route)
}
