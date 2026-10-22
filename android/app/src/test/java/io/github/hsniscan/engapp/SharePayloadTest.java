package io.github.hsniscan.engapp;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class SharePayloadTest {

    private static final String SEND = "android.intent.action.SEND";

    @Test
    public void acceptsSharedText() {
        SharePayload p = SharePayload.from(SEND, "text/plain", "  serendipity \n", null, null);
        assertEquals("serendipity", p.text);
        assertEquals("", p.title);
    }

    @Test
    public void keepsTheSubjectAsTitle() {
        SharePayload p = SharePayload.from(SEND, "text/plain", "https://example.com/a", "A title", "other");
        assertEquals("https://example.com/a", p.text);
        assertEquals("A title", p.title);
    }

    @Test
    public void fallsBackToExtraTitle() {
        SharePayload p = SharePayload.from(SEND, "text/plain", "https://example.com/a", null, "Page");
        assertEquals("Page", p.title);
    }

    @Test
    public void ignoresOtherIntents() {
        assertNull(SharePayload.from("android.intent.action.MAIN", null, null, null, null));
        assertNull(SharePayload.from(SEND, "image/png", "x", null, null));
        assertNull(SharePayload.from(SEND, "text/plain", "   ", null, null));
    }

    @Test
    public void boundsTheText() {
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < SharePayload.MAX_TEXT_CHARS + 10; i++) b.append('a');
        SharePayload p = SharePayload.from(SEND, "text/plain", b, null, null);
        assertEquals(SharePayload.MAX_TEXT_CHARS, p.text.length());
    }
}
