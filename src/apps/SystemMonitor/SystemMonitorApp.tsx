import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/icons';
import { Button } from '../../components/ui/Button';
import { Badge, Meter, Notice } from '../../components/ui/Feedback';
import type { AppProps } from '../../core/app-manager/types';
import { getApp } from '../../core/app-manager/registry';
import { useFsRevision } from '../../core/filesystem/useFs';
import { vfs } from '../../core/filesystem/vfs';
import { estimateStorage } from '../../core/storage/db';
import { useWindowStore } from '../../core/window-manager/store';
import { useNetwork } from '../../hooks/useSystem';
import { formatBytes } from '../../utils/format';
import { cn } from '../../utils/cn';

const SAMPLE_MS = 1000;
const SAMPLES = 60;

interface MemoryInfo {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

export default function SystemMonitorApp(_props: AppProps) {
  const revision = useFsRevision();
  const network = useNetwork();
  const windows = useWindowStore((s) => s.windows);

  const [memory, setMemory] = useState<MemoryInfo | null>(null);
  const [memorySeries, setMemorySeries] = useState<number[]>([]);
  const [fps, setFps] = useState<number | null>(null);
  const [fpsSeries, setFpsSeries] = useState<number[]>([]);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const [uptime, setUptime] = useState(0);

  /** Set on mount rather than during render, which must stay pure. */
  const startedAt = useRef(0);

  /* --------------------------- Memory + uptime ---------------------------- */

  useEffect(() => {
    startedAt.current = Date.now();
    const read = () => {
      const info = (performance as Performance & { memory?: MemoryInfo }).memory;
      if (info) {
        setMemory(info);
        setMemorySeries((series) => [...series, info.usedJSHeapSize].slice(-SAMPLES));
      }
      setUptime(Date.now() - startedAt.current);
    };
    read();
    const timer = setInterval(read, SAMPLE_MS);
    return () => clearInterval(timer);
  }, []);

  /* ------------------------------ Frame rate ------------------------------ */

  useEffect(() => {
    let frames = 0;
    let last = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      frames += 1;
      if (now - last >= 1000) {
        const value = Math.round((frames * 1000) / (now - last));
        setFps(value);
        setFpsSeries((series) => [...series, value].slice(-SAMPLES));
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  /* ------------------------------- Storage -------------------------------- */

  useEffect(() => {
    const read = () => void estimateStorage().then(setStorage);
    read();
    const timer = setInterval(read, 5000);
    return () => clearInterval(timer);
  }, [revision]);

  const fsStats = useMemo(() => {
    void revision;
    return vfs.stats();
  }, [revision]);

  const runningApps = useMemo(() => {
    const counts = new Map<string, number>();
    for (const win of windows) counts.set(win.appId, (counts.get(win.appId) ?? 0) + 1);
    return [...counts.entries()]
      .map(([appId, count]) => ({ app: getApp(appId), appId, count }))
      .sort((a, b) => b.count - a.count);
  }, [windows]);

  const memoryPercent =
    memory && memory.jsHeapSizeLimit > 0 ? (memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100 : 0;

  return (
    <div className="os-scroll h-full overflow-y-auto bg-surface">
      <div className="mx-auto max-w-4xl px-5 py-5">
        {/* ------------------------------ Headline ----------------------------- */}
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            icon="AppWindow"
            label="Open windows"
            value={String(windows.length)}
            detail={`${runningApps.length} applications`}
          />
          <StatTile
            icon="Gauge"
            label="Frame rate"
            value={fps !== null ? `${fps}` : '—'}
            detail="frames per second"
            tone={fps !== null && fps < 30 ? 'warn' : 'ok'}
          />
          <StatTile
            icon="HardDrive"
            label="Filesystem"
            value={formatBytes(fsStats.bytes)}
            detail={`${fsStats.files} files`}
          />
          <StatTile
            icon={network.online ? 'Wifi' : 'WifiOff'}
            label="Network"
            value={network.online ? 'Online' : 'Offline'}
            detail={network.effectiveType ? network.effectiveType.toUpperCase() : 'type not reported'}
            tone={network.online ? 'ok' : 'danger'}
          />
        </div>

        {/* ------------------------------- Memory ------------------------------ */}
        <Panel title="Memory" icon="Cpu">
          {memory ? (
            <>
              <Meter
                label="JavaScript heap in use"
                value={memory.usedJSHeapSize}
                max={memory.jsHeapSizeLimit}
                valueLabel={`${formatBytes(memory.usedJSHeapSize)} of ${formatBytes(memory.jsHeapSizeLimit)}`}
                tone={memoryPercent > 80 ? 'warn' : 'accent'}
              />
              <Sparkline
                values={memorySeries}
                label="Heap usage over the last minute"
                className="mt-3"
              />
              <p className="mt-2 text-[11px] text-ink-3">
                Allocated heap: {formatBytes(memory.totalJSHeapSize)}. This measures Palm OS itself,
                not your computer's RAM — browsers do not expose system memory.
              </p>
            </>
          ) : (
            <Notice tone="neutral" icon="Info" title="Memory reporting is unavailable">
              <code className="font-mono text-[11px]">performance.memory</code> is a non-standard
              Chromium API. Firefox and Safari do not implement it, so there is no figure to show
              here rather than an invented one.
            </Notice>
          )}
        </Panel>

        {/* ---------------------------- Frame rate ----------------------------- */}
        <Panel title="Rendering" icon="Monitor">
          <Sparkline values={fpsSeries} label="Frames per second over the last minute" max={70} />
          <p className="mt-2 text-[11px] text-ink-3">
            Measured with <code className="font-mono">requestAnimationFrame</code>. It reflects how
            smoothly Palm OS is drawing, which is the closest browser-visible equivalent to CPU load.
          </p>
        </Panel>

        {/* ------------------------------ Processor ---------------------------- */}
        <Panel title="Processor" icon="Cpu">
          <InfoGrid
            rows={[
              [
                'Logical cores',
                navigator.hardwareConcurrency
                  ? `${navigator.hardwareConcurrency}`
                  : 'not exposed by this browser',
              ],
              ['Architecture', 'not exposed to web pages'],
              ['Clock speed', 'not exposed to web pages'],
              ['Current load', 'not exposed to web pages'],
            ]}
          />
          <Notice tone="neutral" icon="Shield" title="Why most CPU details are missing" className="mt-3">
            Web pages are deliberately denied processor telemetry: it is a strong fingerprinting
            signal. <code className="font-mono text-[11px]">navigator.hardwareConcurrency</code> is
            the only figure browsers agree to publish.
          </Notice>
        </Panel>

        {/* ------------------------------- Storage ----------------------------- */}
        <Panel title="Storage" icon="Database">
          {storage ? (
            <Meter
              label="Browser storage used by Palm OS"
              value={storage.usage}
              max={Math.max(storage.quota, 1)}
              valueLabel={`${formatBytes(storage.usage)} of ${formatBytes(storage.quota)}`}
              tone={storage.usage / Math.max(storage.quota, 1) > 0.85 ? 'warn' : 'accent'}
            />
          ) : (
            <p className="text-[12px] text-ink-3">This browser does not report a storage estimate.</p>
          )}
          <InfoGrid
            className="mt-3"
            rows={[
              ['Files', String(fsStats.files)],
              ['Folders', String(fsStats.folders)],
              ['Filesystem size', formatBytes(fsStats.bytes)],
              ['Items in Trash', String(vfs.listTrash().length)],
            ]}
          />
        </Panel>

        {/* ------------------------------ Processes ---------------------------- */}
        <Panel title="Running applications" icon="LayoutGrid">
          {runningApps.length === 0 ? (
            <p className="py-2 text-[12.5px] text-ink-3">No applications are running.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {runningApps.map(({ app, appId, count }) => (
                <li
                  key={appId}
                  className="flex items-center gap-2.5 rounded-lg border border-edge/8 bg-surface-2/40 px-3 py-2"
                >
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                    style={{ backgroundColor: `${app?.color ?? '#8b94a8'}26`, color: app?.color ?? '#8b94a8' }}
                  >
                    <Icon name={app?.icon ?? 'AppWindow'} size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-ink">
                      {app?.name ?? appId}
                    </span>
                    <span className="block truncate text-[11px] text-ink-3">
                      {count} {count === 1 ? 'window' : 'windows'}
                    </span>
                  </span>
                  <Badge tone="ok">Running</Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-danger"
                    onClick={() => useWindowStore.getState().closeApp(appId)}
                  >
                    End
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* ------------------------------- System ------------------------------ */}
        <Panel title="System" icon="Info">
          <InfoGrid
            rows={[
              ['Session uptime', formatUptime(uptime)],
              ['Screen', `${window.screen.width} × ${window.screen.height} @ ${window.devicePixelRatio}×`],
              ['Viewport', `${window.innerWidth} × ${window.innerHeight}`],
              ['Colour depth', `${window.screen.colorDepth}-bit`],
              ['Language', navigator.language],
              ['Timezone', Intl.DateTimeFormat().resolvedOptions().timeZone],
              ['Cookies enabled', navigator.cookieEnabled ? 'yes' : 'no'],
              ['User agent', navigator.userAgent],
            ]}
          />
        </Panel>
      </div>
    </div>
  );
}

/* -------------------------------- Pieces --------------------------------- */

function Panel({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <section className="mb-4 rounded-xl border border-edge/10 bg-surface-2/30 p-4 last:mb-0">
      <h2 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-ink">
        <Icon name={icon} size={15} className="text-ink-3" />
        {title}
      </h2>
      {children}
    </section>
  );
}

function StatTile({
  icon,
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  icon: string;
  label: string;
  value: string;
  detail: string;
  tone?: 'neutral' | 'ok' | 'warn' | 'danger';
}) {
  const tones = {
    neutral: 'text-ink-2',
    ok: 'text-ok',
    warn: 'text-warn',
    danger: 'text-danger',
  };
  return (
    <div className="rounded-xl border border-edge/10 bg-surface-2/40 p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-3">
        <Icon name={icon} size={12} />
        {label}
      </p>
      <p className={cn('mt-1.5 text-[20px] font-semibold tabular-nums leading-none', tones[tone])}>{value}</p>
      <p className="mt-1 truncate text-[11px] text-ink-3">{detail}</p>
    </div>
  );
}

function InfoGrid({ rows, className }: { rows: Array<[string, string]>; className?: string }) {
  return (
    <dl className={cn('rounded-lg border border-edge/8 bg-surface', className)}>
      {rows.map(([label, value]) => (
        <div
          key={label}
          className="flex flex-wrap items-baseline justify-between gap-3 border-b border-edge/8 px-3 py-2 last:border-b-0"
        >
          <dt className="shrink-0 text-[12px] text-ink-2">{label}</dt>
          <dd className="min-w-0 break-all text-right text-[11.5px] text-ink-3">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Minimal sparkline.
 *
 * Drawn as an inline SVG path rather than a chart library: one series, no axes,
 * and it must stay legible at 40 pixels tall in both themes.
 */
function Sparkline({
  values,
  label,
  max,
  className,
}: {
  values: number[];
  label: string;
  max?: number;
  className?: string;
}) {
  if (values.length < 2) {
    return (
      <div className={cn('flex h-10 items-center text-[11px] text-ink-3', className)}>
        Collecting samples…
      </div>
    );
  }

  const ceiling = max ?? (Math.max(...values) * 1.15 || 1);
  const width = 100;
  const height = 30;
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - Math.min(1, value / ceiling) * height;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  return (
    <figure className={className}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-10 w-full"
        role="img"
        aria-label={`${label}. Latest value ${values[values.length - 1]}.`}
      >
        <polyline
          points={`0,${height} ${points.join(' ')} ${width},${height}`}
          fill="rgb(var(--os-accent) / 0.16)"
          stroke="none"
        />
        <polyline
          points={points.join(' ')}
          fill="none"
          stroke="rgb(var(--os-accent))"
          strokeWidth="1.2"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
      </svg>
      <figcaption className="mt-1 text-[10.5px] text-ink-3">{label}</figcaption>
    </figure>
  );
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
