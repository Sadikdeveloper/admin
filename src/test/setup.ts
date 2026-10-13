/**
 * Shared test environment. jsdom implements the DOM but not a handful of
 * browser APIs the console uses, so the missing pieces are stubbed here once
 * instead of in every test file.
 */
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
});

if (typeof URL.createObjectURL !== 'function') {
  let counter = 0;
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn(() => `blob:mock/${(counter += 1)}`),
  });
}
if (typeof URL.revokeObjectURL !== 'function') {
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: vi.fn() });
}

if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = vi.fn();
}

if (typeof window.crypto?.randomUUID !== 'function') {
  let n = 0;
  Object.defineProperty(window, 'crypto', {
    configurable: true,
    value: {
      randomUUID: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, '0')}`,
    },
  });
}

/* Timers run in the background between assertions; keep them from leaking. */
afterEach(() => {
  vi.clearAllTimers();
});
