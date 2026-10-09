import { useEffect } from 'react';
import { api } from './api.js';

export function useFreshness(kind: 'analysis' | 'comparison', previewId: string | undefined, onOutdated: () => void) {
  useEffect(() => {
    if (!previewId) return;
    let active = true;
    const check = async () => {
      try {
        const result = await api<{ outdated: boolean }>(`${kind}/freshness`, { previewId });
        if (active && result.outdated) onOutdated();
      } catch { if (active) onOutdated(); }
    };
    void check();
    const timer = setInterval(check, 2000);
    return () => { active = false; clearInterval(timer); };
  }, [kind, previewId, onOutdated]);
}
