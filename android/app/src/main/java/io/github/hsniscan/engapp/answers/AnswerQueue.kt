package io.github.hsniscan.engapp.answers

import java.security.SecureRandom
import java.util.Locale
import java.util.Random
import org.json.JSONArray
import org.json.JSONObject

/**
 * One answer given on the reminder notification ("Bildim" = Good, "Bilemedim" = Again). The web
 * app replays it once through its answer action (src/native/widget.ts replayAnswerQueue) and
 * uses [id] as the review log id, so a second replay changes nothing (docs/decisions/0048).
 */
data class QueuedAnswer(val id: String, val cardId: String, val rating: String, val at: Long) {
    fun toJson(): JSONObject = JSONObject()
        .put("id", id)
        .put("card_id", cardId)
        .put("rating", rating)
        .put("at", at)

    companion object {
        const val GOOD = "Good"
        const val AGAIN = "Again"

        fun fromJson(o: JSONObject?): QueuedAnswer? {
            if (o == null) return null
            val id = o.optString("id", "")
            val cardId = o.optString("card_id", "")
            val rating = o.optString("rating", "")
            val at = o.optLong("at", 0L)
            if (id.isEmpty() || cardId.isEmpty() || at <= 0L) return null
            if (rating != GOOD && rating != AGAIN) return null
            return QueuedAnswer(id, cardId, rating, at)
        }
    }
}

/**
 * The queue as a JSON array string (stored in SharedPreferences). Pure: the Android parts only
 * read and write the string, so this is unit-tested on the JVM.
 */
object AnswerQueue {
    /** Same bound as src/domain/notificationAnswer.ts MAX_QUEUED_ANSWERS. */
    const val MAX_ITEMS = 200

    fun list(raw: String?): List<QueuedAnswer> {
        val arr = parse(raw)
        val out = ArrayList<QueuedAnswer>(arr.length())
        for (i in 0 until arr.length()) QueuedAnswer.fromJson(arr.optJSONObject(i))?.let { out.add(it) }
        return out
    }

    /** Adds [item] unless its id is already there; the oldest items go first beyond [MAX_ITEMS]. */
    fun append(raw: String?, item: QueuedAnswer): String {
        val items = list(raw).filter { it.id != item.id }.toMutableList()
        items.add(item)
        while (items.size > MAX_ITEMS) items.removeAt(0)
        return encode(items)
    }

    /** Removes the acknowledged ids (and anything unreadable among them). */
    fun remove(raw: String?, ids: Set<String>): String {
        val arr = parse(raw)
        val keep = JSONArray()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            if (ids.contains(o.optString("id", ""))) continue
            keep.put(o)
        }
        return keep.toString()
    }

    /** Raw items as stored (also invalid ones, so the web app can name them for removal). */
    fun rawItems(raw: String?): JSONArray = parse(raw)

    /** "Good" answers given at or after [since]: the widget's due count drops by these. */
    fun goodSince(raw: String?, since: Long): Int = list(raw).count { it.rating == QueuedAnswer.GOOD && it.at >= since }

    fun containsCard(raw: String?, cardId: String): Boolean = list(raw).any { it.cardId == cardId }

    private fun encode(items: List<QueuedAnswer>): String {
        val arr = JSONArray()
        for (it in items) arr.put(it.toJson())
        return arr.toString()
    }

    private fun parse(raw: String?): JSONArray {
        if (raw.isNullOrEmpty()) return JSONArray()
        return try {
            JSONArray(raw)
        } catch (e: Exception) {
            JSONArray()
        }
    }
}

/** UUID v7 (RFC 9562), like src/domain/ids.ts: time-ordered, so logs sort as everywhere else. */
object Uuid7 {
    private val secure: Random by lazy { SecureRandom() }

    fun make(ms: Long, random: Random = secure): String {
        val b = ByteArray(16)
        random.nextBytes(b)
        var t = ms
        for (i in 5 downTo 0) {
            b[i] = (t and 0xff).toByte()
            t = t shr 8
        }
        b[6] = (0x70 or (b[6].toInt() and 0x0f)).toByte()
        b[8] = (0x80 or (b[8].toInt() and 0x3f)).toByte()
        val hex = StringBuilder(36)
        for (i in 0 until 16) {
            if (i == 4 || i == 6 || i == 8 || i == 10) hex.append('-')
            hex.append(String.format(Locale.ROOT, "%02x", b[i].toInt() and 0xff))
        }
        return hex.toString()
    }
}
