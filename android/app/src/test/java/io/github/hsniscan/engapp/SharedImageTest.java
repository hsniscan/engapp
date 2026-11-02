package io.github.hsniscan.engapp;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class SharedImageTest {

    private static final String SEND = "android.intent.action.SEND";

    @Test
    public void acceptsOnlyImageShares() {
        assertTrue(SharedImage.accepts(SEND, "image/jpeg"));
        assertTrue(SharedImage.accepts(SEND, "image/*"));
        assertFalse(SharedImage.accepts(SEND, "text/plain"));
        assertFalse(SharedImage.accepts(SEND, null));
        assertFalse(SharedImage.accepts("android.intent.action.VIEW", "image/png"));
    }

    @Test
    public void namesTheCacheFileSafely() {
        assertEquals("17-1.png", SharedImage.fileName("17-1", "image/png"));
        assertEquals("17-1.jpg", SharedImage.fileName("17-1", "image/*"));
        assertEquals("etcpasswd.jpg", SharedImage.fileName("../../etc/passwd", "image/jpeg"));
        assertEquals("image.heic", SharedImage.fileName("", "image/heif"));
    }
}
