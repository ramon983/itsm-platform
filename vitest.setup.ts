import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

// Tests never hit real third-party APIs (status pages, holidays); individual tests stub fetch as needed.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network disabled in tests'))));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
