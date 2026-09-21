import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '../../utils/cn';
import { Icon } from '../icons';

const BASE_INPUT = cn(
  'w-full rounded-lg border border-edge/12 bg-surface-2 px-3 text-sm text-ink',
  'placeholder:text-ink-3 transition-colors duration-150',
  'focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/35',
  'disabled:opacity-50 disabled:cursor-not-allowed',
);

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  hint?: string;
  error?: string;
  icon?: string;
  /** Element rendered at the trailing edge, e.g. a clear button. */
  trailing?: ReactNode;
  hideLabel?: boolean;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, icon, trailing, hideLabel, className, id: providedId, ...rest },
  ref,
) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className={cn('w-full', className)}>
      {label && !hideLabel ? (
        <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink-2">
          {label}
        </label>
      ) : null}
      <div className="relative flex items-center">
        {icon ? (
          <span className="pointer-events-none absolute left-2.5 text-ink-3">
            <Icon name={icon} size={15} />
          </span>
        ) : null}
        <input
          ref={ref}
          id={id}
          aria-label={hideLabel ? label : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(BASE_INPUT, 'h-9', icon && 'pl-8', trailing && 'pr-9', error && 'border-danger')}
          {...rest}
        />
        {trailing ? <span className="absolute right-1.5 flex items-center">{trailing}</span> : null}
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1 flex items-center gap-1 text-xs text-danger">
          <Icon name="CircleAlert" size={12} />
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
});

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  hideLabel?: boolean;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, hint, hideLabel, className, id: providedId, ...rest },
  ref,
) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  return (
    <div className="w-full">
      {label && !hideLabel ? (
        <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink-2">
          {label}
        </label>
      ) : null}
      <textarea
        ref={ref}
        id={id}
        aria-label={hideLabel ? label : undefined}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={cn(BASE_INPUT, 'os-scroll resize-y py-2 leading-relaxed', className)}
        {...rest}
      />
      {hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
});

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  label?: string;
  options: SelectOption[];
  hideLabel?: boolean;
  hint?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, options, hideLabel, hint, className, id: providedId, ...rest },
  ref,
) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  return (
    <div className={cn('w-full', className)}>
      {label && !hideLabel ? (
        <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink-2">
          {label}
        </label>
      ) : null}
      <div className="relative">
        <select
          ref={ref}
          id={id}
          aria-label={hideLabel ? label : undefined}
          className={cn(BASE_INPUT, 'h-9 cursor-pointer appearance-none pr-8')}
          {...rest}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3">
          <Icon name="ChevronDown" size={14} />
        </span>
      </div>
      {hint ? <p className="mt-1 text-xs text-ink-3">{hint}</p> : null}
    </div>
  );
});

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: string;
}

export interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: Array<SegmentedOption<T>>;
  label: string;
  className?: string;
  size?: 'sm' | 'md';
}

/** Radio-group segmented control (view switchers, theme picker, …). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
  size = 'md',
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        // `max-w-full` + horizontal scroll rather than wrapping: a segmented
        // control that wraps stops reading as one control.
        'os-scroll inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg',
        'border border-edge/10 bg-surface-2 p-0.5',
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md font-medium',
              'transition-colors duration-150',
              size === 'sm' ? 'h-6 px-2 text-xs' : 'h-8 px-3 text-sm',
              selected
                ? 'bg-accent text-accent-fg shadow-sm'
                : 'text-ink-2 hover:bg-surface-3 hover:text-ink',
            )}
          >
            {option.icon ? <Icon name={option.icon} size={size === 'sm' ? 12 : 14} /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
