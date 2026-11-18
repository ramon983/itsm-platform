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
  const highContrast = usePlatformStore((s) => s.highContrast);
  const systemDark = useSyncExternalStore(subscribe, () => media()?.matches ?? true, () => true);
  const systemContrast = useSyncExternalStore(subscribe, () => moreContrast()?.matches ?? false, () => false);
  // High contrast (switch, or the OS asking for it in Automatic) wins; otherwise Automatic follows the OS light/dark setting.
  const resolved = highContrast || (pref === 'system' && systemContrast) ? 'contrast' : pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
  const density = usePlatformStore((s) => s.density);
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.density = density;
  }, [resolved, density]);
  return resolved;
}

const OPTIONS: { key: ThemePreference; icon: typeof Sun; label: string; hint: string }[] = [
  { key: 'system', icon: Monitor, label: 'Automatic', hint: 'Automatic — follows your computer’s light/dark setting' },
  { key: 'light', icon: Sun, label: 'Light', hint: 'Light mode' },
  { key: 'dark', icon: Moon, label: 'Dark', hint: 'Dark mode' },
];

export function ThemeSwitcher() {
  const pref = usePlatformStore((s) => s.themePreference);
  const setPref = usePlatformStore((s) => s.setThemePreference);
  const highContrast = usePlatformStore((s) => s.highContrast);
  const setHighContrast = usePlatformStore((s) => s.setHighContrast);
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex rounded-full border border-white/[0.08] p-0.5" role="radiogroup" aria-label="Appearance">
        {OPTIONS.map(({ key, icon: Icon, label, hint }) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={pref === key}
            aria-label={label}
            title={hint}
            onClick={() => setPref(key)}
            className={clsx('grid size-8 place-items-center rounded-full transition', pref === key ? 'bg-white/[0.1] text-slate-100' : 'text-slate-500 hover:text-slate-200')}
          >
            <Icon className="size-3.5" aria-hidden />
          </button>
        ))}
      </div>
      <button
        type="button"
        aria-pressed={highContrast}
        aria-label="High contrast"
        title={highContrast ? 'High contrast is on' : 'Turn on high contrast (WCAG AAA)'}
        onClick={() => setHighContrast(!highContrast)}
        className={clsx('grid size-8 place-items-center rounded-full border transition', highContrast ? 'border-indigo-500 bg-white/[0.1] text-slate-100' : 'border-white/[0.08] text-slate-500 hover:text-slate-200')}
      >
        <Contrast className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
