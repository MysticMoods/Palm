import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Button } from './ui/Button';
import { Icon } from './icons';

interface Props {
  children: ReactNode;
  /** Called when a render throws, so the window can record the crash. */
  onError?: (error: Error, info: ErrorInfo) => void;
  /** Custom UI; when omitted the standard "stopped responding" panel shows. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** Changing this value clears the error and remounts the subtree. */
  resetKey?: unknown;
}

interface State {
  error: Error | null;
}

/**
 * Isolates a crashing subtree.
 *
 * A single misbehaving application must never take the desktop down with it,
 * so every window's content is wrapped in one of these.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[palm] application crashed', error, info.componentStack);
    this.props.onError?.(error, info);
  }

  componentDidUpdate(previous: Props) {
    if (previous.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-surface p-8 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-danger/15 text-danger">
          <Icon name="AlertTriangle" size={22} />
        </span>
        <div>
          <p className="text-[15px] font-semibold text-ink">Application stopped responding</p>
          <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-ink-3">
            {error.message || 'An unexpected error occurred.'}
          </p>
        </div>
        <Button variant="secondary" icon="RotateCcw" onClick={this.reset}>
          Restart
        </Button>
      </div>
    );
  }
}
