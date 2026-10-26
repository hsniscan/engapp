package io.github.hsniscan.engapp;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class QuickIntentsTest {

    private static final String PROCESS = "android.intent.action.PROCESS_TEXT";

    @Test
    public void acceptsASelection() {
        QuickIntents q = QuickIntents.processText(PROCESS, "text/plain", "  serendipity\n", false);
        assertEquals("serendipity", q.text);
        assertFalse(q.readonly);
    }

    @Test
    public void keepsTheReadOnlyFlagAsInformation() {
        QuickIntents q = QuickIntents.processText(PROCESS, "text/plain", "word", true);
        assertTrue(q.readonly);
    }

    @Test
    public void ignoresOtherIntents() {
        assertNull(QuickIntents.processText("android.intent.action.SEND", "text/plain", "x", false));
        assertNull(QuickIntents.processText(PROCESS, "image/png", "x", false));
        assertNull(QuickIntents.processText(PROCESS, "text/plain", "   ", false));
        assertNull(QuickIntents.processText(PROCESS, "text/plain", null, false));
    }

    @Test
    public void boundsTheSelection() {
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < SharePayload.MAX_TEXT_CHARS + 5; i++) b.append('a');
        assertEquals(SharePayload.MAX_TEXT_CHARS, QuickIntents.processText(PROCESS, null, b, false).text.length());
    }

    @Test
    public void opensOnlyReaderAndAddAddresses() {
        assertTrue(QuickIntents.isOpenablePath("/oku/0192f3a0-1b2c-7d4e-8f90-123456789abc"));
        assertTrue(QuickIntents.isOpenablePath("/add?term=serendipity"));
        assertTrue(QuickIntents.isOpenablePath("/add?term=give%20up"));
        assertFalse(QuickIntents.isOpenablePath(null));
        assertFalse(QuickIntents.isOpenablePath("/settings"));
        assertFalse(QuickIntents.isOpenablePath("//evil.example/oku/1"));
        assertFalse(QuickIntents.isOpenablePath("https://evil.example/"));
        assertFalse(QuickIntents.isOpenablePath("/oku/1/../../settings"));
        assertFalse(QuickIntents.isOpenablePath("/add?term=a&tab=x"));
    }

    @Test
    public void boundsTheHandover() {
        assertNull(QuickIntents.handoverText("  "));
        assertEquals("a b", QuickIntents.handoverText(" a b "));
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < QuickIntents.MAX_HANDOVER_CHARS + 5; i++) b.append('a');
        assertEquals(QuickIntents.MAX_HANDOVER_CHARS, QuickIntents.handoverText(b.toString()).length());
    }
}
