package io.github.hsniscan.engapp.answers

import org.json.JSONObject

/**
 * A planned reminder that asks one card (src/native/widget.ts CardReminderPayload). All text
 * comes from the web app (src/i18n/tr.json, namespace "widget"), already in the user's
 * language. Stored as JSON until it is shown, and carried in the buttons' intents after that.
 */
data class CardReminder(
    val id: Int,
    val at: Long,
    val title: String,
    val body: String,
    val url: String,
    val channelId: String,
    val cardId: String,
    val question: String,
    val answer: String,
    val reveal: String,
    val knew: String,
    val forgot: String,
    val saved: String,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("id", id)
        .put("at", at)
        .put("title", title)
        .put("body", body)
        .put("url", url)
        .put("channelId", channelId)
        .put("card", JSONObject().put("card_id", cardId).put("question", question).put("answer", answer))
        .put(
            "labels",
            JSONObject().put("reveal", reveal).put("knew", knew).put("forgot", forgot).put("saved", saved),
        )

    companion object {
        private const val MAX_TEXT = 500

        private fun text(o: JSONObject?, key: String): String {
            val s = o?.optString(key, "") ?: ""
            return if (s.length > MAX_TEXT) s.substring(0, MAX_TEXT) else s
        }

        /** Null for anything incomplete: such a reminder is not planned at all. */
        fun fromJson(o: JSONObject?): CardReminder? {
            if (o == null || !o.has("id")) return null
            val card = o.optJSONObject("card")
            val labels = o.optJSONObject("labels")
            val r = CardReminder(
                id = o.optInt("id"),
                at = o.optLong("at", 0L),
                title = text(o, "title"),
                body = text(o, "body"),
                url = text(o, "url"),
                channelId = text(o, "channelId"),
                cardId = text(card, "card_id"),
                question = text(card, "question"),
                answer = text(card, "answer"),
                reveal = text(labels, "reveal"),
                knew = text(labels, "knew"),
                forgot = text(labels, "forgot"),
                saved = text(labels, "saved"),
            )
            val complete = r.at > 0L && r.cardId.isNotEmpty() && r.question.isNotEmpty() && r.answer.isNotEmpty() &&
                r.reveal.isNotEmpty() && r.knew.isNotEmpty() && r.forgot.isNotEmpty() && r.title.isNotEmpty()
            return if (complete) r else null
        }

        fun fromString(s: String?): CardReminder? = try {
            if (s.isNullOrEmpty()) null else fromJson(JSONObject(s))
        } catch (e: Exception) {
            null
        }
    }
}
