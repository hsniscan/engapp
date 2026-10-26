package io.github.hsniscan.engapp.answers

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import io.github.hsniscan.engapp.widget.EngappWidgets

/**
 * The reminder that asks a card (docs/decisions/0048): the alarm, the three buttons, and
 * re-planning after a reboot or an app update. Not exported: only the app's own alarms and
 * PendingIntents (and the system's boot broadcasts) reach it.
 */
class CardReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val c = context.applicationContext
        val now = System.currentTimeMillis()
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> CardReminders.restore(c, now)
            CardReminders.ACTION_SHOW -> {
                val id = intent.getIntExtra(CardReminders.EXTRA_ID, Int.MIN_VALUE)
                if (id == Int.MIN_VALUE) return
                CardReminders.takePlanned(c, id)?.let { CardReminders.showQuestion(c, it) }
            }
            CardReminders.ACTION_REVEAL -> reminder(intent)?.let { CardReminders.showAnswer(c, it) }
            CardReminders.ACTION_KNEW, CardReminders.ACTION_FORGOT -> {
                val r = reminder(intent) ?: return
                val rating = if (intent.action == CardReminders.ACTION_KNEW) QueuedAnswer.GOOD else QueuedAnswer.AGAIN
                CardReminders.answer(c, r, rating, now)
                // The due count on the widget drops at once (it subtracts queued "Bildim" answers).
                val pending = goAsync()
                EngappWidgets.updateAllAsync(c) { pending.finish() }
            }
        }
    }

    private fun reminder(intent: Intent): CardReminder? =
        CardReminder.fromString(intent.getStringExtra(CardReminders.EXTRA_REMINDER))
}
