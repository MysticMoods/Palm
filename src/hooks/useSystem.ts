import { useEffect, useState, useSyncExternalStore } from 'react';

/* ------------------------------ Media query ----------------------------- */

export function useMediaQuery(query: string): boolean {
  const subscribe = (callback: () => void) => {
    const media = window.matchMedia(query);
    media.addEventListener('change', callback);
    return () => media.removeEventListener('change', callback);
  };
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/* ---------------------------- Viewport size ----------------------------- */

export interface ViewportSize {
  width: number;
  height: number;
}

export function useViewport(): ViewportSize {
  const [size, setSize] = useState<ViewportSize>(() => ({
    width: typeof window === 'undefined' ? 1280 : window.innerWidth,
    height: typeof window === 'undefined' ? 720 : window.innerHeight,
  }));

  useEffect(() => {
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        setSize({ width: window.innerWidth, height: window.innerHeight }),
      );
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  return size;
}

/* ------------------------------- Network -------------------------------- */

export interface NetworkInfo {
  online: boolean;
  /** Effective connection type, when the browser exposes it. */
  effectiveType: string | null;
  downlink: number | null;
  rtt: number | null;
  saveData: boolean | null;
}

interface NetworkInformation extends EventTarget {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
}

function readNetwork(): NetworkInfo {
  const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  return {
    online: navigator.onLine,
    effectiveType: connection?.effectiveType ?? null,
    downlink: connection?.downlink ?? null,
    rtt: connection?.rtt ?? null,
    saveData: connection?.saveData ?? null,
  };
}

/**
 * Connection status. `navigator.onLine` only reports whether the browser has a
 * network interface — it cannot tell you the internet is actually reachable,
 * which is why the UI phrases this as "connected", not "internet working".
 */
export function useNetwork(): NetworkInfo {
  const [info, setInfo] = useState<NetworkInfo>(() =>
    typeof navigator === 'undefined'
      ? { online: true, effectiveType: null, downlink: null, rtt: null, saveData: null }
      : readNetwork(),
  );

  useEffect(() => {
    const update = () => setInfo(readNetwork());
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
    connection?.addEventListener('change', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      connection?.removeEventListener('change', update);
    };
  }, []);

  return info;
}

/* ------------------------------- Battery -------------------------------- */

export interface BatteryInfo {
  supported: boolean;
  level: number | null;
  charging: boolean | null;
  chargingTime: number | null;
  dischargingTime: number | null;
}

interface BatteryManager extends EventTarget {
  level: number;
  charging: boolean;
  chargingTime: number;
  dischargingTime: number;
}

/**
 * Battery status via the Battery Status API.
 *
 * Chromium-only: Firefox and Safari removed it as a fingerprinting vector, so
 * `supported: false` is the normal result there and the UI says as much rather
 * than inventing a number.
 */
export function useBattery(): BatteryInfo {
  const [info, setInfo] = useState<BatteryInfo>({
    supported: false,
    level: null,
    charging: null,
    chargingTime: null,
    dischargingTime: null,
  });

  useEffect(() => {
    const getBattery = (navigator as Navigator & { getBattery?: () => Promise<BatteryManager> })
      .getBattery;
    if (!getBattery) return;

    let battery: BatteryManager | null = null;
    let cancelled = false;

    const update = () => {
      if (!battery || cancelled) return;
      setInfo({
        supported: true,
        level: battery.level,
        charging: battery.charging,
        chargingTime: Number.isFinite(battery.chargingTime) ? battery.chargingTime : null,
        dischargingTime: Number.isFinite(battery.dischargingTime) ? battery.dischargingTime : null,
      });
    };

    getBattery
      .call(navigator)
      .then((manager) => {
        if (cancelled) return;
        battery = manager;
        update();
        for (const event of ['levelchange', 'chargingchange', 'chargingtimechange', 'dischargingtimechange']) {
          manager.addEventListener(event, update);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      if (battery) {
        for (const event of ['levelchange', 'chargingchange', 'chargingtimechange', 'dischargingtimechange']) {
          battery.removeEventListener(event, update);
        }
      }
    };
  }, []);

  return info;
}

/* ------------------------------ Fullscreen ------------------------------ */

export function useFullscreen(): { isFullscreen: boolean; toggle: () => void; supported: boolean } {
  const [isFullscreen, setIsFullscreen] = useState(
    () => typeof document !== 'undefined' && document.fullscreenElement !== null,
  );

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const supported = typeof document !== 'undefined' && document.fullscreenEnabled;

  const toggle = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      // Must be called from a user gesture; the browser rejects it otherwise.
      void document.documentElement.requestFullscreen().catch(() => undefined);
    }
  };

  return { isFullscreen, toggle, supported };
}
