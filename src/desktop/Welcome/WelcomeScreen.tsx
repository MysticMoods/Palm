import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PalmMark } from '../../components/PalmMark';
import { Button } from '../../components/ui/Button';
import { setShortcutsSuspended } from '../../core/keyboard/manager';
import { useSettingsStore } from '../../core/settings/store';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { cn } from '../../utils/cn';
import { AppearanceStep, HelloStep, IdentityStep, ReadyStep } from './steps';
import type { WallpaperTab } from './steps';
import { WelcomeBackdrop } from './WelcomeBackdrop';

const STEPS = [
  { id: 'hello', label: 'Welcome' },
  { id: 'identity', label: 'Your profile' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'ready', label: 'Ready' },
] as const;

/** Length of the exit animation; the desktop is revealed underneath. */
const EXIT_MS = 420;

/**
 * First-run welcome tour.
 *
 * Rendered over a live desktop rather than instead of one, so choices apply
 * immediately — the wallpaper behind the card is the real wallpaper — and
 * finishing simply dissolves the overlay to reveal the desktop already wearing
 * them. Global shortcuts are suspended while it is up, since the shell beneath
 * would otherwise react to Super or Alt+Tab.
 */
export function WelcomeScreen({ onDone }: { onDone: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [wallpaperTab, setWallpaperTab] = useState<WallpaperTab>('Gradients');

  const settings = useSettingsStore((s) => s.settings);
  const profile = useSettingsStore((s) => s.profile);
  const setSetting = useSettingsStore((s) => s.set);
  const updateProfile = useSettingsStore((s) => s.updateProfile);

  useFocusTrap(panelRef, !leaving);

  useEffect(() => {
    setShortcutsSuspended(true);
    return () => setShortcutsSuspended(false);
  }, []);


  const step = STEPS[index];
  const isLast = index === STEPS.length - 1;

  const finish = useCallback(() => {
    if (leaving) return;
    setLeaving(true);
    // Persist only once the animation is under way, so the desktop behind is
    // already correct when the overlay clears.
    setSetting('welcomeCompleted', true);
    window.setTimeout(onDone, EXIT_MS);
  }, [leaving, onDone, setSetting]);

  /*
   * Escape is handled at the window rather than on the card.
   *
   * The focus trap keeps Tab inside, but focus can still land on <body> for a
   * moment — a button that unmounts when the step changes takes its focus with
   * it — and a React handler on the card never sees a key pressed there.
   */
  useEffect(() => {
    const onKeyDownWindow = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || leaving) return;
      event.preventDefault();
      finish();
    };
    window.addEventListener('keydown', onKeyDownWindow);
    return () => window.removeEventListener('keydown', onKeyDownWindow);
  }, [finish, leaving]);

  const next = useCallback(() => {
    if (isLast) finish();
    else setIndex((current) => Math.min(current + 1, STEPS.length - 1));
  }, [finish, isLast]);

  const back = useCallback(() => setIndex((current) => Math.max(current - 1, 0)), []);

  /* Enter advances, unless a control inside the card owns the key. */
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'Enter') return;
    const target = event.target as HTMLElement;
    if (target.tagName === 'BUTTON' || target.tagName === 'INPUT' || target.tagName === 'SELECT') return;
    event.preventDefault();
    next();
  };

  const body = useMemo(() => {
    switch (step.id) {
      case 'identity':
        return <IdentityStep profile={profile} onChange={updateProfile} onSubmit={next} />;
      case 'appearance':
        return (
          <AppearanceStep
            settings={settings}
            tab={wallpaperTab}
            onTabChange={setWallpaperTab}
            onSet={setSetting}
          />
        );
      case 'ready':
        return <ReadyStep profile={profile} searchShortcut={settings.searchShortcut} />;
      default:
        return <HelloStep />;
    }
  }, [next, profile, setSetting, settings, step.id, updateProfile, wallpaperTab]);

  return (
    <div
      className={cn('fixed inset-0 z-[10000] flex items-center justify-center p-4', leaving && 'anim-zoom-out')}
      onKeyDown={onKeyDown}
    >
      <WelcomeBackdrop />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
        tabIndex={-1}
        className={cn(
          'os-glass-strong anim-pop relative flex w-full max-w-lg flex-col overflow-hidden',
          'rounded-2xl shadow-[0_32px_90px_-20px_rgb(0_0_0/0.7)] outline-none',
          'max-h-[calc(100vh-2rem)]',
        )}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/35 to-transparent"
        />
        {/* ------------------------------ Progress ----------------------------- */}
        <div className="flex shrink-0 items-center gap-3 border-b border-edge/8 px-5 py-3">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-accent-fg">
            <PalmMark size={15} />
          </span>
          <ol className="flex flex-1 items-center gap-1.5" aria-label="Setup progress">
            {STEPS.map((entry, position) => (
              <li key={entry.id} className="flex flex-1 items-center">
                <span
                  aria-current={position === index ? 'step' : undefined}
                  className={cn(
                    'h-1 w-full rounded-full transition-colors duration-300',
                    position < index ? 'bg-accent/50' : position === index ? 'bg-accent' : 'bg-surface-3',
                  )}
                />
                <span className="sr-only-focusable">
                  {entry.label}
                  {position === index ? ' (current step)' : ''}
                </span>
              </li>
            ))}
          </ol>
          <span aria-live="polite" className="shrink-0 text-[11px] tabular-nums text-ink-3">
            {index + 1} of {STEPS.length}
          </span>
        </div>

        {/* ------------------------------- Content ----------------------------- */}
        <div className="os-scroll min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <h1 id="welcome-title" className="sr-only-focusable absolute">
            {step.label}
          </h1>
          {/* Keyed so the reveal animation replays on every step change. */}
          <div key={step.id}>{body}</div>
        </div>

        {/* ------------------------------- Footer ------------------------------ */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-edge/8 bg-surface-2/40 px-5 py-3.5">
          {index === 0 ? (
            <Button variant="ghost" size="sm" onClick={finish}>
              Skip setup
            </Button>
          ) : (
            <Button variant="ghost" size="sm" icon="ArrowLeft" onClick={back}>
              Back
            </Button>
          )}

          <Button
            variant="primary"
            iconRight={isLast ? undefined : 'ArrowRight'}
            icon={isLast ? 'Check' : undefined}
            onClick={next}
            data-autofocus={step.id === 'hello' || step.id === 'ready' ? true : undefined}
          >
            {index === 0 ? 'Get started' : isLast ? 'Enter Palm OS' : 'Continue'}
          </Button>
        </div>
      </div>
    </div>
  );
}
