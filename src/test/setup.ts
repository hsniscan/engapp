import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { setHomeSettleMsForTesting } from '@/features/home/settle';
import { resetToasts } from '@/ui/toast-store';

// Bugün's secondary cards wait for the page to settle in the app (decision 0059), not in tests.
setHomeSettleMsForTesting(0);

// The toast queue is module state; without this an open toast from one test can match the next
// test's findByText (two "Fark kartı eklendi" toasts in leech.test.tsx).
afterEach(() => resetToasts());
