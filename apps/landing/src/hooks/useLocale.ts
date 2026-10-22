import { useCallback, useEffect, useState } from 'react';

export type Locale = 'en' | 'es';

const STORAGE_KEY = 'helix-locale';

export function useLocale() {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved === 'es' ? 'es' : 'en';
  });

  useEffect(() => {
    document.documentElement.lang = locale;
    window.localStorage.setItem(STORAGE_KEY, locale);
  }, [locale]);

  const setLocale = useCallback((next: Locale) => setLocaleState(next), []);
  return { locale, setLocale };
}

