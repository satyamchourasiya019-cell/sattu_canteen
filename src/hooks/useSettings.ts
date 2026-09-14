import { useEffect, useState } from 'react';
import { subscribeSettings, DEFAULT_SETTINGS } from '../services/settingsService';
import type { CanteenSettings } from '../types';

export function useSettings(): { settings: CanteenSettings; loading: boolean } {
  const [settings, setSettings] = useState<CanteenSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = subscribeSettings(
      (s) => {
        setSettings(s);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return () => {
      unsub();
      setLoading(false);
    };
  }, []);

  return { settings, loading };
}
