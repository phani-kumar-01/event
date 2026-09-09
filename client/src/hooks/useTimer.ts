import { useState, useEffect, useCallback } from 'react';

/**
 * Calculates and updates a live countdown timer.
 * Returns { remaining, formatted } where remaining is seconds and
 * formatted is "MM:SS".
 * Pass `endTime` as an ISO string from the server.
 */
export function useTimer(endTime: string | null | undefined) {
  const [remaining, setRemaining] = useState(0);

  const calculate = useCallback(() => {
    if (!endTime) return 0;
    const diff = Math.max(0, Math.floor((new Date(endTime).getTime() - Date.now()) / 1000));
    return diff;
  }, [endTime]);

  useEffect(() => {
    setRemaining(calculate());
    if (!endTime) return;

    const interval = setInterval(() => {
      const r = calculate();
      setRemaining(r);
      if (r <= 0) clearInterval(interval);
    }, 1000);

    return () => clearInterval(interval);
  }, [endTime, calculate]);

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const formatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  return { remaining, formatted };
}
