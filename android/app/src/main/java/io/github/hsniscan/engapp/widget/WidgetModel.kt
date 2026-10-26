package io.github.hsniscan.engapp.widget

import io.github.hsniscan.engapp.answers.AnswerQueue
import org.json.JSONObject

/** The word of the day as the widget shows it (src/domain/widget.ts WidgetWord). */
data class WidgetWord(val tr: String, val en: String, val noteId: String)

/**
 * What the widgets draw, from `widget_state` (written by the web app, src/native/widget.ts) and
 * the queue of answers given on the notification. Pure, unit-tested on the JVM.
 *
 * [due] is null when the state is missing or too old to trust (the app has not run for more
 * than a day): the widget then asks to open the app instead of showing a wrong number.
 */
data class WidgetView(
    val day: String?,
    val due: Int?,
    val newCount: Int,
    val word: WidgetWord?,
    /** The word's Turkish side is turned over (one reveal state, for today's word only). */
    val revealed: Boolean,
) {
    /** Key of the single stored reveal state: it resets by itself when the word changes. */
    val revealKey: String? get() = if (day != null && word != null) "$day|${word.noteId}" else null

    companion object {
        val EMPTY = WidgetView(null, null, 0, null, false)

        fun from(stateJson: String?, queueJson: String?, revealedKey: String?, now: Long): WidgetView {
            val s = parse(stateJson) ?: return EMPTY
            val updatedAt = s.optLong("updated_at", 0L)
            // Today, or the next day once today's end has passed (the app was not opened).
            val today = s.optLong("day_end", 0L)
            val next = s.optJSONObject("next")
            val shown: JSONObject
            val since: Long
            when {
                now < today -> {
                    shown = s
                    since = updatedAt
                }
                next != null && now < next.optLong("day_end", 0L) -> {
                    shown = next
                    since = maxOf(updatedAt, today)
                }
                else -> return EMPTY.copy(word = word(next ?: s), day = (next ?: s).optString("day", null))
            }
            val day = shown.optString("day", null)
            val base = shown.optInt("due", 0)
            // "Bildim" on the notification takes the card off today's list until the app applies it.
            val due = maxOf(0, base - AnswerQueue.goodSince(queueJson, since))
            val w = word(shown)
            val view = WidgetView(day, due, maxOf(0, shown.optInt("new_count", 0)), w, false)
            return view.copy(revealed = revealedKey != null && revealedKey == view.revealKey)
        }

        private fun word(o: JSONObject?): WidgetWord? {
            val w = o?.optJSONObject("word") ?: return null
            val tr = w.optString("tr", "")
            val en = w.optString("en", "")
            val id = w.optString("note_id", "")
            return if (tr.isEmpty() || en.isEmpty() || id.isEmpty()) null else WidgetWord(tr, en, id)
        }

        private fun parse(raw: String?): JSONObject? {
            if (raw.isNullOrEmpty()) return null
            return try {
                val o = JSONObject(raw)
                if (o.optInt("v", 0) == 1 && o.has("day")) o else null
            } catch (e: Exception) {
                null
            }
        }
    }
}

/** The in-app routes a widget tap opens (the web app checks them again). */
object WidgetRoutes {
    const val STUDY = "/study?mode=word"
    const val HOME = "/"

    fun word(noteId: String): String = "/library?note=" + java.net.URLEncoder.encode(noteId, "UTF-8")
}
