import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';
import { afterEach } from 'vitest';
import { setHomeSettleMsForTesting } from '@/features/home/settle';
import { resetToasts } from '@/ui/toast-store';

// findBy*/waitFor give up after 1 s by default. A busy CI runner (content jobs running beside
// it) sometimes needs longer for the first Dexie read (todayRefresh.test.tsx, 1.16 s); a
// passing check returns as soon as it passes, so only real failures wait the full 5 s.
configure({ asyncUtilTimeout: 5000 });

// Bugün's secondary cards wait for the page to settle in the app (decision 0059), not in tests.
setHomeSettleMsForTesting(0);

// The toast queue is module state; without this an open toast from one test can match the next
// test's findByText (two "Fark kartı eklendi" toasts in leech.test.tsx).
afterEach(() => resetToasts());
