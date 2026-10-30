import { useEffect, useRef, useState } from "react";

export const POLL_MS = 3000;

/** Calls `load` now and every `ms` while mounted; keeps the last good value on errors. */
export function usePolling<T>(load: () => Promise<T>, deps: unknown[], ms = POLL_MS): { data?: T; error?: string; refresh: () => void } {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | undefined>();
  const loadRef = useRef(load);
  loadRef.current = load;
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const run = () =>
      loadRef.current().then(
        (d) => {
          if (!cancelled) {
            setData(d);
            setError(undefined);
          }
        },
        (e: unknown) => !cancelled && setError((e as Error).message),
      );
    void run();
    const t = setInterval(run, ms);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, ms, tick]);

  return { data, error, refresh: () => setTick((n) => n + 1) };
}
