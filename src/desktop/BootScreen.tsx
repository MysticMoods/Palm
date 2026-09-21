import { Icon } from '../components/icons';
import { PalmMark } from '../components/PalmMark';
import { Button } from '../components/ui/Button';
import { OS_CODENAME, OS_NAME, OS_VERSION } from '../core/settings/defaults';

/**
 * Splash shown while the OS boots, and the failure state when it cannot.
 *
 * Boot is usually a few hundred milliseconds, so this is deliberately calm: a
 * mark, the version, and an indeterminate bar. No fake progress percentage —
 * there is nothing meaningful to measure.
 */
export function BootScreen({ error }: { error?: string | null }) {
  if (error) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-5 bg-canvas p-8 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-danger/15 text-danger">
          <Icon name="AlertTriangle" size={30} />
        </span>
        <div>
          <p className="text-lg font-semibold tracking-tight text-ink">{OS_NAME} could not start</p>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-2">{error}</p>
        </div>
        <p className="mx-auto max-w-sm text-xs leading-relaxed text-ink-3">
          This usually means the browser is blocking local storage. Private windows and “block all
          cookies” both prevent {OS_NAME} from keeping a filesystem.
        </p>
        <Button variant="secondary" icon="RotateCcw" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center gap-6 overflow-hidden bg-canvas p-8 text-center">
      <div
        aria-hidden="true"
        className="aurora-a absolute left-1/2 top-1/2 h-[70vmax] w-[70vmax] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-30 blur-[100px]"
        style={{
          background: 'radial-gradient(circle, rgb(var(--os-accent) / 0.5), transparent 65%)',
        }}
      />

      <span className="anim-float relative flex h-20 w-20 items-center justify-center rounded-3xl bg-accent text-accent-fg shadow-[0_16px_44px_-14px_rgb(var(--os-accent)/0.8)]">
        <PalmMark size={44} animated />
      </span>

      <div className="relative">
        <p className="text-xl font-semibold tracking-tight text-ink">{OS_NAME}</p>
        <p className="mt-1 text-xs text-ink-3">
          Version {OS_VERSION} “{OS_CODENAME}”
        </p>
      </div>

      {/* Indeterminate: a sweeping highlight rather than a fabricated figure. */}
      <div
        role="status"
        aria-label={`Starting ${OS_NAME}`}
        className="relative h-[3px] w-40 overflow-hidden rounded-full bg-surface-3"
      >
        <span className="anim-sweep absolute inset-y-0 w-1/4 rounded-full bg-accent" />
      </div>
    </div>
  );
}
