import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';
import { Icon } from '../icons';

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <span role="status" aria-label="Loading" className={cn('inline-flex text-ink-3', className)}>
      <Icon name="Loader" size={size} className="anim-spin" />
    </span>
  );
}

export interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}

export function EmptyState({ icon, title, description, action, className, compact }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'gap-2 p-6' : 'gap-3 p-10',
        className,
      )}
    >
      {icon ? (
        <span
          className={cn(
            'flex items-center justify-center rounded-2xl bg-surface-2 text-ink-3',
            compact ? 'h-10 w-10' : 'h-14 w-14',
          )}
        >
          <Icon name={icon} size={compact ? 18 : 24} />
        </span>
      ) : null}
      <div>
        <p className={cn('font-medium text-ink-2', compact ? 'text-sm' : 'text-base')}>{title}</p>
        {description ? (
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-ink-3">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export type BadgeTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-3 text-ink-2',
  accent: 'bg-accent-soft text-accent-ink',
  ok: 'bg-ok/15 text-ok',
  warn: 'bg-warn/15 text-warn',
  danger: 'bg-danger/15 text-danger',
};

export function Badge({
  children,
  tone = 'neutral',
  icon,
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  icon?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-none',
        TONES[tone],
        className,
      )}
    >
      {icon ? <Icon name={icon} size={10} /> : null}
      {children}
    </span>
  );
}

/** Inline notice used for limitations, errors and tips inside apps. */
export function Notice({
  tone = 'neutral',
  icon,
  title,
  children,
  className,
}: {
  tone?: BadgeTone;
  icon?: string;
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  const border: Record<BadgeTone, string> = {
    neutral: 'border-edge/12 bg-surface-2',
    accent: 'border-accent/30 bg-accent-soft',
    ok: 'border-ok/30 bg-ok/10',
    warn: 'border-warn/30 bg-warn/10',
    danger: 'border-danger/30 bg-danger/10',
  };
  const iconTone: Record<BadgeTone, string> = {
    neutral: 'text-ink-3',
    accent: 'text-accent-ink',
    ok: 'text-ok',
    warn: 'text-warn',
    danger: 'text-danger',
  };
  return (
    <div className={cn('flex gap-2.5 rounded-lg border p-3', border[tone], className)}>
      {icon ? (
        <span className={cn('mt-px shrink-0', iconTone[tone])}>
          <Icon name={icon} size={15} />
        </span>
      ) : null}
      <div className="min-w-0 text-xs leading-relaxed text-ink-2">
        {title ? <p className="mb-0.5 text-sm font-medium text-ink">{title}</p> : null}
        {children}
      </div>
    </div>
  );
}

/** Horizontal meter with a text value — never colour alone. */
export function Meter({
  value,
  max = 100,
  label,
  valueLabel,
  tone = 'accent',
  className,
}: {
  value: number;
  max?: number;
  label: string;
  valueLabel?: string;
  tone?: BadgeTone;
  className?: string;
}) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const fill: Record<BadgeTone, string> = {
    neutral: 'bg-ink-3',
    accent: 'bg-accent',
    ok: 'bg-ok',
    warn: 'bg-warn',
    danger: 'bg-danger',
  };
  return (
    <div className={className}>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        <span className="text-ink-2">{label}</span>
        <span className="tabular-nums text-ink-3">{valueLabel ?? `${Math.round(percent)}%`}</span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuetext={valueLabel}
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
      >
        <div
          className={cn('h-full rounded-full transition-[width] duration-500', fill[tone])}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
