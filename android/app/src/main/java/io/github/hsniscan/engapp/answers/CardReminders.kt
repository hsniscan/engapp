package io.github.hsniscan.engapp.answers

import android.Manifest
import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import io.github.hsniscan.engapp.MainActivity
import io.github.hsniscan.engapp.R

/**
 * Plans, shows and answers the reminder that asks a card (docs/decisions/0048). The alarm is
 * inexact (setAndAllowWhileIdle, no exact-alarm permission), like the plain reminder of
 * @capacitor/local-notifications. The buttons are broadcasts to [CardReminderReceiver], so
 * "Cevabı gör", "Bildim" and "Bilemedim" work without opening the app.
 */
object CardReminders {
    const val ACTION_SHOW = "io.github.hsniscan.engapp.answers.SHOW"
    const val ACTION_REVEAL = "io.github.hsniscan.engapp.answers.REVEAL"
    const val ACTION_KNEW = "io.github.hsniscan.engapp.answers.KNEW"
    const val ACTION_FORGOT = "io.github.hsniscan.engapp.answers.FORGOT"
    const val EXTRA_ID = "engapp_reminder_id"
    const val EXTRA_REMINDER = "engapp_reminder"
    /** Read by WidgetBridgePlugin: the in-app route a tap opens. */
    const val EXTRA_ROUTE = "engapp_route"

    private const val PLANNED = "engapp_card_reminders"
    private const val QUEUE_PREFS = "engapp_answers"
    private const val QUEUE_KEY = "queue"
    /** A reminder that could not be shown for this long (phone off) is dropped at boot. */
    private const val STALE_MS = 12L * 60 * 60 * 1000
    private const val SAVED_TIMEOUT_MS = 6_000L

    // ------------------------------------------------------------------ queue

    private fun queuePrefs(c: Context) = c.getSharedPreferences(QUEUE_PREFS, Context.MODE_PRIVATE)

    @Synchronized
    fun readQueue(c: Context): String? = queuePrefs(c).getString(QUEUE_KEY, null)

    @Synchronized
    fun appendAnswer(c: Context, item: QueuedAnswer) {
        val p = queuePrefs(c)
        // commit(): the answer is on disk before the receiver returns (the process may die).
        p.edit().putString(QUEUE_KEY, AnswerQueue.append(p.getString(QUEUE_KEY, null), item)).commit()
    }

    @Synchronized
    fun ack(c: Context, ids: Set<String>) {
        val p = queuePrefs(c)
        p.edit().putString(QUEUE_KEY, AnswerQueue.remove(p.getString(QUEUE_KEY, null), ids)).commit()
    }

    // ------------------------------------------------------------------ planning

    private fun planned(c: Context) = c.getSharedPreferences(PLANNED, Context.MODE_PRIVATE)

    private fun showIntent(c: Context, id: Int): PendingIntent {
        val i = Intent(c, CardReminderReceiver::class.java).setAction(ACTION_SHOW).putExtra(EXTRA_ID, id)
        return PendingIntent.getBroadcast(
            c, id, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    fun schedule(c: Context, list: List<CardReminder>) {
        val am = c.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val edit = planned(c).edit()
        for (r in list) {
            edit.putString(r.id.toString(), r.toJson().toString())
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, r.at, showIntent(c, r.id))
        }
        edit.commit()
    }

    fun cancel(c: Context, ids: List<Int>) {
        val am = c.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val edit = planned(c).edit()
        for (id in ids) {
            am.cancel(showIntent(c, id))
            edit.remove(id.toString())
        }
        edit.commit()
    }

    fun clearShown(c: Context, ids: List<Int>) {
        val nm = NotificationManagerCompat.from(c)
        for (id in ids) nm.cancel(id)
    }

    /** After a reboot or an app update the alarms are gone: plan the stored ones again. */
    fun restore(c: Context, now: Long) {
        val all = planned(c).all
        val keep = ArrayList<CardReminder>()
        val drop = ArrayList<Int>()
        for ((key, value) in all) {
            val r = CardReminder.fromString(value as? String)
            if (r == null || r.at < now - STALE_MS) key.toIntOrNull()?.let { drop.add(it) } else keep.add(r)
        }
        if (drop.isNotEmpty()) cancel(c, drop)
        if (keep.isNotEmpty()) schedule(c, keep)
    }

    /** The stored reminder for an alarm that fired; removed from the plan. */
    fun takePlanned(c: Context, id: Int): CardReminder? {
        val p = planned(c)
        val r = CardReminder.fromString(p.getString(id.toString(), null))
        p.edit().remove(id.toString()).commit()
        return r
    }

    // ------------------------------------------------------------------ notifications

    private fun canNotify(c: Context): Boolean {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return false
        return NotificationManagerCompat.from(c).areNotificationsEnabled()
    }

    /** Opens the app on [route] (the same in-app path the plain reminder opens). */
    fun openApp(c: Context, route: String, requestCode: Int): PendingIntent {
        val i = Intent(c, MainActivity::class.java)
            .setAction(Intent.ACTION_VIEW)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra(EXTRA_ROUTE, route)
        return PendingIntent.getActivity(
            c, requestCode, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun button(c: Context, r: CardReminder, action: String, offset: Int): PendingIntent {
        val i = Intent(c, CardReminderReceiver::class.java)
            .setAction(action)
            .putExtra(EXTRA_ID, r.id)
            .putExtra(EXTRA_REMINDER, r.toJson().toString())
        return PendingIntent.getBroadcast(
            c, r.id * 8 + offset, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun base(c: Context, r: CardReminder): NotificationCompat.Builder =
        NotificationCompat.Builder(c, r.channelId.ifEmpty { "engapp-reminders" })
            .setSmallIcon(R.drawable.ic_stat_engapp)
            .setColor(ContextCompat.getColor(c, R.color.engapp_accent))
            .setContentTitle(r.title)
            .setContentIntent(openApp(c, r.url.ifEmpty { "/study?mode=word" }, r.id))
            .setAutoCancel(true)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setOnlyAlertOnce(true)

    private fun post(c: Context, id: Int, b: NotificationCompat.Builder) {
        if (!canNotify(c)) return
        try {
            NotificationManagerCompat.from(c).notify(id, b.build())
        } catch (e: SecurityException) {
            // permission withdrawn in between: nothing to show
        }
    }

    /** The alarm fired: ask the card, or just remind when that card was already answered. */
    fun showQuestion(c: Context, r: CardReminder) {
        val b = base(c, r)
        if (AnswerQueue.containsCard(readQueue(c), r.cardId)) {
            b.setContentText(r.body)
        } else {
            b.setContentText(r.question)
                .setStyle(NotificationCompat.BigTextStyle().bigText("${r.body}\n${r.question}"))
                .addAction(0, r.reveal, button(c, r, ACTION_REVEAL, 1))
        }
        post(c, r.id, b)
    }

    /** "Cevabı gör": the same notification now shows the meaning and the two answers. */
    fun showAnswer(c: Context, r: CardReminder) {
        val b = base(c, r)
            .setContentText(r.answer)
            .setStyle(NotificationCompat.BigTextStyle().bigText(r.answer))
            .setAutoCancel(false)
            .setSilent(true)
            .addAction(0, r.knew, button(c, r, ACTION_KNEW, 2))
            .addAction(0, r.forgot, button(c, r, ACTION_FORGOT, 3))
        post(c, r.id, b)
    }

    /** "Bildim" / "Bilemedim": queue the answer and confirm briefly (the receiver then redraws the widgets). */
    fun answer(c: Context, r: CardReminder, rating: String, now: Long) {
        // A second tap on a stale notification must not answer twice.
        if (!AnswerQueue.containsCard(readQueue(c), r.cardId)) {
            appendAnswer(c, QueuedAnswer(Uuid7.make(now), r.cardId, rating, now))
        }
        val b = base(c, r)
            .setContentText(r.saved.ifEmpty { r.answer })
            .setSilent(true)
            .setTimeoutAfter(SAVED_TIMEOUT_MS)
        post(c, r.id, b)
    }
}
