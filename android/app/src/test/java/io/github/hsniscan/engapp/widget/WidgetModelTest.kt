package io.github.hsniscan.engapp.widget

import io.github.hsniscan.engapp.answers.AnswerQueue
import io.github.hsniscan.engapp.answers.QueuedAnswer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WidgetModelTest {
    // Written by src/domain/widget.ts buildWidgetState.
    private val state = """
        {"v":1,"day":"2026-10-26","due":12,"new_count":5,"day_end":2000,
         "word":{"tr":"dayanıklı","en":"resilient","note_id":"n1"},
         "next":{"day":"2026-10-27","due":20,"new_count":10,"day_end":3000,
                 "word":{"tr":"kırılgan","en":"brittle","note_id":"n2"}},
         "updated_at":1000}
    """.trimIndent()

    @Test
    fun showsTodayBeforeTheDayEnds() {
        val v = WidgetView.from(state, null, null, 1500)
        assertEquals("2026-10-26", v.day)
        assertEquals(12, v.due)
        assertEquals(5, v.newCount)
        assertEquals(WidgetWord("dayanıklı", "resilient", "n1"), v.word)
        assertFalse(v.revealed)
        assertEquals("2026-10-26|n1", v.revealKey)
    }

    @Test
    fun switchesToTheNextDayWhileTheAppIsClosed() {
        val v = WidgetView.from(state, null, "2026-10-26|n1", 2500)
        assertEquals("2026-10-27", v.day)
        assertEquals(20, v.due)
        assertEquals("brittle", v.word?.en)
        // Yesterday's reveal does not carry over to the new word.
        assertFalse(v.revealed)
    }

    @Test
    fun asksToOpenTheAppWhenTheStateIsTooOld() {
        val v = WidgetView.from(state, null, null, 3500)
        assertNull(v.due)
        assertEquals("brittle", v.word?.en)
        assertNull(WidgetView.from(null, null, null, 0).due)
        assertNull(WidgetView.from("{\"v\":2,\"day\":\"x\"}", null, null, 0).word)
        assertNull(WidgetView.from("garbage", null, null, 0).word)
    }

    @Test
    fun keepsOneRevealStateForTodaysWord() {
        assertTrue(WidgetView.from(state, null, "2026-10-26|n1", 1500).revealed)
        assertFalse(WidgetView.from(state, null, "2026-10-25|n1", 1500).revealed)
        assertFalse(WidgetView.from(state, null, "2026-10-26|other", 1500).revealed)
    }

    @Test
    fun subtractsKnownAnswersFromTheNotificationUntilTheAppAppliesThem() {
        var q = AnswerQueue.append(null, QueuedAnswer("id-1", "c1", QueuedAnswer.GOOD, 1200))
        q = AnswerQueue.append(q, QueuedAnswer("id-2", "c2", QueuedAnswer.AGAIN, 1300)) // still due
        q = AnswerQueue.append(q, QueuedAnswer("id-3", "c3", QueuedAnswer.GOOD, 900)) // already counted
        assertEquals(11, WidgetView.from(state, q, null, 1500).due)
        val zero = state.replace("\"due\":12", "\"due\":0")
        assertEquals(0, WidgetView.from(zero, q, null, 1500).due)
    }

    @Test
    fun routes() {
        assertEquals("/study?mode=word", WidgetRoutes.STUDY)
        assertEquals("/library?note=n%201", WidgetRoutes.word("n 1").replace("+", "%20"))
    }
}
