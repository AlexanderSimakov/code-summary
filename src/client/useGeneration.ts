import { useCallback, useEffect, useRef, useState } from 'react';

/** One active browser request. Aborts network work and discards superseded results. */
export function useGeneration() {
  const active = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const cancel = useCallback(() => {
    active.current?.abort();
    active.current = null;
    setPending(false);
  }, []);
  useEffect(() => cancel, [cancel]);
  async function run<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    try {
      const result = await task(controller.signal);
      if (!controller.signal.aborted && active.current === controller) return result;
    } catch (error) {
      if (!controller.signal.aborted && active.current === controller) throw error;
    } finally {
      if (active.current === controller) { active.current = null; setPending(false); }
    }
  }
  return { pending, run, cancel };
}
