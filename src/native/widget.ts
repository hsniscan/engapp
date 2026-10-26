// Home-screen widgets and answers from the reminder notification in the Android app
// (docs/decisions/0048-widget-notification-answers.md). Loaded by ./start only in the app.
//
//   widget_state   JSON the widgets read (@capacitor/preferences → SharedPreferences group
//                  "CapacitorStorage"), written after every answer (so after every session),
//                  after a sync, when the app comes back and at the day rollover; then
//                  WidgetBridge.refresh() redraws the widgets (Glance updateAll).
//   answer queue   what the user answered on the notification ("Bildim" / "Bilemedim"), kept
//                  by the Android side and replayed here once each, through the same answer
//                  action as the study screen (data/actions.ts replayQueuedAnswer).
import { liveQuery } from 'dexie';
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Preferences } from '@capacitor/preferences';
import { router } from '@/app/router';
import { db, logError, replayQueuedAnswer } from '@/data';
import { getWidgetState } from '@/data/widget';
import { invalidQueueIds, parseAnswerQueue, ratingValue } from '@/domain/notificationAnswer';
import { parseWidgetState, WIDGET_STATE_KEY } from '@/domain/widget';
import { engine } from '@/sync';

interface WidgetBridgePlugin {
  /** Redraws every Engapp widget from widget_state. */
  refresh(): Promise<void>;
  /** A widget or notification tap that should open a screen: {route}. Retained until heard. */
  addListener(
    event: 'routeOpened',
    cb: (d: { route: string }) => void,
  ): Promise<PluginListenerHandle>;
}

export interface CardReminderPayload {
  id: number;
  at: number;
  title: string;
  body: string;
  url: string;
  channelId: string;
  card: { card_id: string; question: string; answer: string };
  labels: { reveal: string; knew: string; forgot: string; saved: string };
}

interface ReminderAnswersPlugin {
  /** Plans notifications that ask a card (own alarm + receiver: the buttons work without the app). */
  schedule(o: { notifications: CardReminderPayload[] }): Promise<void>;
  /** Cancels planned ones (shown ones stay). */
  cancel(o: { ids: number[] }): Promise<void>;
  /** Removes shown ones. */
  clearShown(o: { ids: number[] }): Promise<void>;
  /** The answers given on notifications and not acknowledged yet. */
  readQueue(): Promise<{ items: unknown[] }>;
  /** Removes these answers from the queue (after they were applied). */
  ack(o: { ids: string[] }): Promise<void>;
}

export const WidgetBridge = registerPlugin<WidgetBridgePlugin>('WidgetBridge');
export const ReminderAnswers = registerPlugin<ReminderAnswersPlugin>('ReminderAnswers');

// ------------------------------------------------------------------ answer queue

let replaying: Promise<number> = Promise.resolve(0);

/**
 * Applies every queued notification answer once, oldest first, then clears them from the queue.
 * An item that fails (database busy) stays queued for the next resume; an item already in the
 * history (applied before the app was killed) is only cleared. Returns how many were applied.
 */
export function replayAnswerQueue(now: () => number = Date.now): Promise<number> {
  const run = async () => {
    const { items } = await ReminderAnswers.readQueue();
    const done = invalidQueueIds(items);
    let applied = 0;
    for (const item of parseAnswerQueue(items)) {
      try {
        const r = await replayQueuedAnswer({ ...item, rating: ratingValue(item.rating) }, now());
        if (r.status === 'applied') applied++;
        done.push(item.id);
      } catch (e) {
        void logError(e, 'widget.replay');
      }
    }
    if (done.length) await ReminderAnswers.ack({ ids: done });
    return applied;
  };
  const next = replaying.then(run, run);
  replaying = next.catch(() => 0);
  return next;
}

// ------------------------------------------------------------------ widget state

let writing: Promise<void> = Promise.resolve();

/** Writes widget_state from the database and redraws the widgets. Serialised. */
export function refreshWidgets(): Promise<void> {
  const run = async () => {
    const previous = parseWidgetState((await Preferences.get({ key: WIDGET_STATE_KEY })).value);
    const state = await getWidgetState(previous);
    await Preferences.set({ key: WIDGET_STATE_KEY, value: JSON.stringify(state) });
    await WidgetBridge.refresh();
    planRollover(state.day_end);
  };
  const next = writing.then(run, run);
  writing = next.catch(() => {});
  return next;
}

let timer: ReturnType<typeof setTimeout> | null = null;
function soon(where: string, ms = 2000): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    refreshWidgets().catch((e: unknown) => void logError(e, where));
  }, ms);
}

let rollover: ReturnType<typeof setTimeout> | null = null;
/** While the app stays open across the day boundary, the widget gets the new day at once. */
function planRollover(dayEnd: number): void {
  if (rollover) clearTimeout(rollover);
  const ms = dayEnd - Date.now() + 5_000;
  // setTimeout's limit is ~24.8 days; a day is far below it.
  if (ms > 0 && ms < 2 * 86_400_000) rollover = setTimeout(() => soon('widget.rollover', 0), ms);
}

/** Only an in-app path opens from a widget or notification tap. */
export function isAppRoute(route: unknown): route is string {
  return (
    typeof route === 'string' &&
    route.startsWith('/') &&
    !route.startsWith('//') &&
    route.length < 512
  );
}

async function onResume(): Promise<void> {
  try {
    await replayAnswerQueue();
  } catch (e) {
    void logError(e, 'widget.resume.replay');
  }
  soon('widget.resume', 300);
}

let started = false;

export async function startWidgets(): Promise<void> {
  if (started) return;
  started = true;

  await WidgetBridge.addListener('routeOpened', ({ route }) => {
    if (isAppRoute(route)) void router.navigate(route);
  });

  // Every answer (the study screen, a replayed notification answer, an undo) and every change
  // a sync brings changes the count or the word.
  liveQuery(async () => {
    const [last, cards, settings] = await Promise.all([
      db.review_logs.orderBy('reviewed_at').last(),
      db.cards.count(),
      db.settings.get('settings'),
    ]);
    return `${last?.id ?? ''}|${cards}|${settings?.updated_at ?? ''}`;
  }).subscribe({
    next: () => soon('widget.change'),
    error: (e: unknown) => void logError(e, 'widget.watch'),
  });

  // After a sync run (it may bring answers and cards from another device).
  let wasRunning = engine.getSnapshot().running;
  engine.subscribe(() => {
    const running = engine.getSnapshot().running;
    if (wasRunning && !running) soon('widget.sync');
    wasRunning = running;
  });

  await App.addListener('resume', () => void onResume());
  await onResume();
}
