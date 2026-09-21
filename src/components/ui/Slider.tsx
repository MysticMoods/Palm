import { useId } from 'react';
import { cn } from '../../utils/cn';

export interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  hideLabel?: boolean;
  /** Text shown next to the label, e.g. "55%". */
  valueLabel?: string;
  disabled?: boolean;
  className?: string;
  icon?: React.ReactNode;
}

/**
 * Range input styled to match the OS.
 *
 * Uses a native `<input type="range">` so keyboard interaction, screen-reader
 * announcements and touch handling all come for free.
 */
export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  label,
  hideLabel = false,
  valueLabel,
  disabled = false,
  className,
  icon,
}: SliderProps) {
  const id = useId();
  const percent = max === min ? 0 : ((value - min) / (max - min)) * 100;

  return (
    <div className={cn('w-full', className)}>
      {!hideLabel ? (
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <label htmlFor={id} className="text-sm text-ink">
            {label}
          </label>
          {valueLabel ? <span className="text-xs tabular-nums text-ink-3">{valueLabel}</span> : null}
        </div>
      ) : null}
      <div className="flex items-center gap-2.5">
        {icon}
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-label={hideLabel ? label : undefined}
          aria-valuetext={valueLabel}
          onChange={(event) => onChange(Number(event.target.value))}
          className={cn(
            'os-slider h-5 w-full cursor-pointer appearance-none bg-transparent',
            'disabled:opacity-40 disabled:cursor-not-allowed',
          )}
          style={{ ['--fill' as string]: `${percent}%` }}
        />
      </div>
    </div>
  );
}
