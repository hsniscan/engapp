import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { resetToasts } from '@/ui/toast-store';

// The toast queue is module state; without this an open toast from one test can match the next
// test's findByText (two "Fark kartı eklendi" toasts in leech.test.tsx).
afterEach(() => resetToasts());
