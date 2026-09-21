import { useEffect, useState } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Button } from './components/ui/Button';
import { bootPalmOS } from './core/boot';
import { useSettingsStore } from './core/settings/store';
import { useShellStore } from './core/shell/store';
import { registerBuiltInApps } from './apps';
import { BootScreen } from './desktop/BootScreen';
import { Shell } from './desktop/Shell';
import { WelcomeScreen } from './desktop/Welcome/WelcomeScreen';

registerBuiltInApps();

export default function App() {
  const bootPhase = useShellStore((s) => s.bootPhase);
  const bootError = useShellStore((s) => s.bootError);
  const welcomeCompleted = useSettingsStore((s) => s.settings.welcomeCompleted);
  /*
   * Held separately from the setting so the exit animation can finish before
   * the overlay unmounts, and so "replay the tour" can re-open it without
   * clearing the stored flag first.
   */
  const [showWelcome, setShowWelcome] = useState(false);

  useEffect(() => {
    void bootPalmOS();
  }, []);

  useEffect(() => {
    if (bootPhase === 'ready' && !welcomeCompleted) setShowWelcome(true);
  }, [bootPhase, welcomeCompleted]);

  if (bootPhase !== 'ready') {
    return <BootScreen error={bootPhase === 'error' ? bootError : null} />;
  }

  return (
    <ErrorBoundary
      fallback={(error, reset) => (
        <div className="flex h-full flex-col items-center justify-center gap-4 bg-canvas p-8 text-center">
          <p className="text-base font-semibold text-ink">The desktop stopped responding</p>
          <p className="max-w-md text-xs leading-relaxed text-ink-3">{error.message}</p>
          <div className="flex gap-2">
            <Button variant="primary" icon="RotateCcw" onClick={reset}>
              Restart the shell
            </Button>
            <Button variant="ghost" onClick={() => window.location.reload()}>
              Reload Palm OS
            </Button>
          </div>
        </div>
      )}
    >
      <Shell />
      {showWelcome ? <WelcomeScreen onDone={() => setShowWelcome(false)} /> : null}
    </ErrorBoundary>
  );
}
