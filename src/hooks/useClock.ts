import { useEffect, useState } from 'react';

/**
 * A ticking clock that only re-renders as often as it needs to, and re-syncs
 * to the top of the next tick so the minute never changes a second late.
 */
export function useClock(withSeconds = false): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const schedule = () => {
      const current = new Date();
      setNow(current);
      const period = withSeconds ? 1000 : 60_000;
      const elapsed = withSeconds
        ? current.getMilliseconds()
        : current.getSeconds() * 1000 + current.getMilliseconds();
      timer = setTimeout(schedule, period - elapsed);
    };

    schedule();
    return () => clearTimeout(timer);
  }, [withSeconds]);

  return now;
}
