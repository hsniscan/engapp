package io.github.hsniscan.engapp.answers

import java.util.Random
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AnswerQueueTest {
    private val a = QueuedAnswer("0192f0a0-0000-7000-8000-000000000001", "card-1", QueuedAnswer.GOOD, 1_000L)
    private val b = QueuedAnswer("0192f0a0-0000-7000-8000-000000000002", "card-2", QueuedAnswer.AGAIN, 2_000L)

    @Test
    fun appendsOncePerIdAndKeepsOrder() {
        var q = AnswerQueue.append(null, a)
        q = AnswerQueue.append(q, b)
        q = AnswerQueue.append(q, a) // the same answer again: no second item
        assertEquals(listOf(b, a), AnswerQueue.list(q))
    }

    @Test
    fun writesWhatTheWebAppReads() {
        val o = JSONArray(AnswerQueue.append(null, a)).getJSONObject(0)
        assertEquals(a.id, o.getString("id"))
        assertEquals("card-1", o.getString("card_id"))
        assertEquals("Good", o.getString("rating"))
        assertEquals(1_000L, o.getLong("at"))
    }

    @Test
    fun removesAcknowledgedIdsOnly() {
        val q = AnswerQueue.append(AnswerQueue.append(null, a), b)
        assertEquals(listOf(b), AnswerQueue.list(AnswerQueue.remove(q, setOf(a.id))))
        assertEquals(listOf(a, b), AnswerQueue.list(AnswerQueue.remove(q, setOf("other"))))
    }

    @Test
    fun boundsTheQueue() {
        var q: String? = null
        for (i in 0 until AnswerQueue.MAX_ITEMS + 5) q = AnswerQueue.append(q, a.copy(id = "id-$i", at = i.toLong() + 1))
        val items = AnswerQueue.list(q)
        assertEquals(AnswerQueue.MAX_ITEMS, items.size)
        assertEquals("id-5", items.first().id)
    }

    @Test
    fun survivesBrokenStorage() {
        assertTrue(AnswerQueue.list("not json").isEmpty())
        assertTrue(AnswerQueue.list("[{\"id\":\"x\"},42]").isEmpty())
        assertEquals(2, AnswerQueue.rawItems("[{\"id\":\"x\"},42]").length())
        assertEquals(listOf(a), AnswerQueue.list(AnswerQueue.append("garbage", a)))
    }

    @Test
    fun countsGoodAnswersSinceAndFindsCards() {
        val q = AnswerQueue.append(AnswerQueue.append(null, a), b)
        assertEquals(1, AnswerQueue.goodSince(q, 0L))
        assertEquals(0, AnswerQueue.goodSince(q, 1_001L)) // only Again after that
        assertTrue(AnswerQueue.containsCard(q, "card-2"))
        assertFalse(AnswerQueue.containsCard(q, "card-3"))
    }

    @Test
    fun rejectsUnknownRatings() {
        assertNull(QueuedAnswer.fromJson(JSONObject().put("id", "x").put("card_id", "c").put("rating", "Easy").put("at", 1)))
    }

    @Test
    fun makesTimeOrderedUuidV7() {
        val r = Random(1)
        val id = Uuid7.make(0x0192f0a01234L, r)
        assertTrue(id.matches(Regex("^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")))
        assertTrue(id.startsWith("0192f0a0-1234-7"))
        assertTrue(Uuid7.make(1_000L, r) < Uuid7.make(2_000L, r))
    }
}
