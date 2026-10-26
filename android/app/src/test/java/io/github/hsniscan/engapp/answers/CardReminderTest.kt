package io.github.hsniscan.engapp.answers

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CardReminderTest {
    // The payload src/native/reminders.ts sends (CardReminderPayload).
    private val payload = """
        {"id":1001,"at":1792580400000,"title":"Tekrar zamanı","body":"Bugün 3 tekrar seni bekliyor",
         "url":"/review","channelId":"engapp-reminders",
         "card":{"card_id":"c1","question":"resilient ne demek?","answer":"resilient: dayanıklı"},
         "labels":{"reveal":"Cevabı gör","knew":"Bildim","forgot":"Bilemedim","saved":"Kaydedildi"}}
    """.trimIndent()

    @Test
    fun readsThePayloadAndRoundTrips() {
        val r = CardReminder.fromString(payload)!!
        assertEquals(1001, r.id)
        assertEquals("c1", r.cardId)
        assertEquals("Cevabı gör", r.reveal)
        assertEquals("resilient: dayanıklı", r.answer)
        assertEquals(r, CardReminder.fromString(r.toJson().toString()))
    }

    @Test
    fun refusesAnIncompleteReminder() {
        val o = JSONObject(payload)
        o.getJSONObject("card").put("card_id", "")
        assertNull(CardReminder.fromJson(o))
        assertNull(CardReminder.fromString("{"))
        assertNull(CardReminder.fromString(null))
    }

    @Test
    fun boundsLongTexts() {
        val o = JSONObject(payload)
        o.put("body", "x".repeat(5_000))
        assertEquals(500, CardReminder.fromJson(o)!!.body.length)
    }
}
