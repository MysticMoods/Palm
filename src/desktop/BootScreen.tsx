import { Icon } from '../components/icons';
import { Button } from '../components/ui/Button';
import { OS_NAME, OS_VERSION } from '../core/settings/defaults';

export function BootScreen({ error }: { error?: string | null }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-5 bg-canvas p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-soft text-accent-ink">
        <Icon name={error ? 'AlertTriangle' : 'Sparkles'} size={30} />
      </div>
      <div>
        <p className="text-lg font-semibold tracking-tight text-ink">{OS_NAME}</p>
        <p className="mt-1 text-xs text-ink-3">Version {OS_VERSION}</p>
      </div>

      {error ? (
        <>
          <p className="max-w-sm text-sm leading-relaxed text-ink-2">
            Failed to load Palm OS : {error}
          </p>
          <p className="max-w-sm text-xs leading-relaxed text-ink-3">
            This usually means the browser is blocking the necessory file to open plam OS
          </p>
          <Button variant="secondary" icon="RotateCcw" onClick={() => window.location.reload()}>
            Try again
          </Button>
        </>
      ) : (
        <div className="flex items-center gap-2 text-ink-3">
          <Icon name="Loader" size={15} className="anim-spin" />
          <span className="text-xs">Cooking…</span>
        </div>
      )}
    </div>
  );
}
