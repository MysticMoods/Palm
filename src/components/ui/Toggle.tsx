import { useId } from 'react';
import { cn } from '../../utils/cn';
import { Icon } from '../icons';

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  /** Hide the visible label but keep it for assistive tech. */
  hideLabel?: boolean;
  className?: string;
}

/**
 * Switch control.
 *
 * State is communicated by position *and* by a check/cross glyph, so it is not
 * conveyed by colour alone (and stays readable in high-contrast mode).
 */
export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  hideLabel = false,
  className,
}: ToggleProps) {
  const id = useId();
  const descriptionId = description ? `${id}-description` : undefined;

  const control = (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={hideLabel ? label : undefined}
      aria-describedby={descriptionId}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border',
        'transition-colors duration-200 disabled:opacity-40 disabled:pointer-events-none',
        checked ? 'bg-accent border-accent' : 'bg-surface-3 border-edge/15',
      )}
    >
      <span
        className={cn(
          'flex h-[18px] w-[18px] items-center justify-center rounded-full bg-white shadow-sm',
          'transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]',
          checked ? 'translate-x-[23px]' : 'translate-x-[3px]',
        )}
      >
        <Icon
          name={checked ? 'Check' : 'X'}
          size={11}
          strokeWidth={3}
          className={checked ? 'text-accent' : 'text-ink-3'}
        />
      </span>
    </button>
  );

  if (hideLabel) return <span className={className}>{control}</span>;

  return (
    <div className={cn('flex items-center justify-between gap-4 py-1', className)}>
      <div className="min-w-0">
        <label htmlFor={id} className="block text-sm text-ink cursor-pointer select-none">
          {label}
        </label>
        {description ? (
          <p id={descriptionId} className="mt-0.5 text-xs text-ink-3 leading-snug">
            {description}
          </p>
        ) : null}
      </div>
      {control}
    </div>
  );
}
