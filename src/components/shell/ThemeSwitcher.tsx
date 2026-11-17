'use client';

import clsx from 'clsx';
import { Contrast, Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useSyncExternalStore } from 'react';

import { usePlatformStore, type ThemePreference } from '@/store/usePlatformStore';

// Guarded: some embedded browsers and test environments lack matchMedia — fall back to dark.
const mq = (q: string) => (typeof window.matchMedia === 'function' ? window.matchMedia(q) : null);
const media = () => mq('(prefers-color-scheme: dark)');
const moreContrast = () => mq('(prefers-contrast: more)');
const subscribe = (cb: () => void) => {
  const list = [media(), moreContrast()];
  list.forEach((m) => m?.addEventListener('change', cb));
  return () => list.forEach((m) => m?.removeEventListener('change', cb));
};

/** Applies the user's theme to <html data-theme> and follows the OS when set to System. */
export function useApplyTheme() {
  const pref = usePlatformStore((s) => s.themePreference);
  const systemDark = useSyncExternalStore(subscribe, () => media()?.matches ?? true, () => true);
  const systemContrast = useSyncExternalStore(subscribe, () => moreContrast()?.matches ?? false, () => false);
  // "System" honours the OS: increased-contrast requests win, then light/dark.
  const resolved = pref === 'system' ? (systemContrast ? 'contrast' : systemDark ? 'dark' : 'light') : pref;
  const density = usePlatformStore((s) => s.density);
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.density = density;
  }, [resolved, density]);
  return resolved;
}

const OPTIONS: { key: ThemePreference; icon: typeof Sun; label: string }[] = [
  { key: 'light', icon: Sun, label: 'Light' },
  { key: 'dark', icon: Moon, label: 'Dark' },
  { key: 'contrast', icon: Contrast, label: 'High contrast' },
  { key: 'system', icon: Monitor, label: 'Match system' },
];

export function ThemeSwitcher() {
  const pref = usePlatformStore((s) => s.themePreference);
  const setPref = usePlatformStore((s) => s.setThemePreference);
  return (
    <div className="flex rounded-full border border-white/[0.08] p-0.5" role="radiogroup" aria-label="Theme">
      {OPTIONS.map(({ key, icon: Icon, label }) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={pref === key}
          aria-label={label}
          title={label}
          onClick={() => setPref(key)}
          className={clsx('grid size-8 place-items-center rounded-full transition', pref === key ? 'bg-white/[0.1] text-slate-100' : 'text-slate-500 hover:text-slate-200')}
        >
          <Icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}
