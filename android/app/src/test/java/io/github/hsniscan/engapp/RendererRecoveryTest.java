package io.github.hsniscan.engapp;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class RendererRecoveryTest {

    @Test
    public void rebuildsOnceThenStopsALoop() {
        RendererRecovery r = new RendererRecovery();
        assertEquals(RendererRecovery.Action.RECREATE, r.onRendererGone(1_000));
        assertEquals(RendererRecovery.Action.FINISH, r.onRendererGone(5_000));
    }

    @Test
    public void rebuildsAgainAfterAQuietPeriod() {
        RendererRecovery r = new RendererRecovery();
        assertEquals(RendererRecovery.Action.RECREATE, r.onRendererGone(1_000));
        assertEquals(RendererRecovery.Action.RECREATE, r.onRendererGone(1_000 + RendererRecovery.LOOP_WINDOW_MS));
    }
}
