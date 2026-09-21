import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../utils/cn';
import { Icon } from '../icons';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-accent-fg hover:brightness-110 active:brightness-95 border border-transparent',
  secondary:
    'bg-surface-2 text-ink hover:bg-surface-3 border border-edge/10 active:brightness-95',
  ghost: 'bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink border border-transparent',
  subtle: 'bg-surface-2/60 text-ink-2 hover:bg-surface-2 hover:text-ink border border-transparent',
  danger: 'bg-danger text-white hover:brightness-110 border border-transparent',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5 rounded-md',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-lg',
  lg: 'h-11 px-5 text-sm gap-2 rounded-lg',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: string;
  iconRight?: string;
  loading?: boolean;
  fullWidth?: boolean;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    icon,
    iconRight,
    loading = false,
    fullWidth = false,
    className,
    children,
    disabled,
    ...rest
  },
  ref,
) {
  const iconSize = size === 'sm' ? 13 : size === 'lg' ? 17 : 15;
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center font-medium whitespace-nowrap',
        'transition-[background-color,filter,border-color] duration-150',
        'disabled:opacity-45 disabled:pointer-events-none select-none',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Icon name="Loader" size={iconSize} className="anim-spin shrink-0" />
      ) : icon ? (
        <Icon name={icon} size={iconSize} className="shrink-0" />
      ) : null}
      {children}
      {iconRight && !loading ? <Icon name={iconRight} size={iconSize} className="shrink-0" /> : null}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: string;
  /** Required: icon-only controls must still be announced. */
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  active?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, variant = 'ghost', size = 'md', active = false, className, ...rest },
  ref,
) {
  const box = size === 'sm' ? 'h-7 w-7 rounded-md' : size === 'lg' ? 'h-11 w-11 rounded-lg' : 'h-9 w-9 rounded-lg';
  const iconSize = size === 'sm' ? 14 : size === 'lg' ? 19 : 16;
  return (
    <button
      ref={ref}
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active || undefined}
      className={cn(
        'inline-flex items-center justify-center shrink-0',
        'transition-[background-color,filter,color] duration-150',
        'disabled:opacity-40 disabled:pointer-events-none',
        VARIANTS[variant],
        box,
        active && 'bg-accent-soft text-accent',
        className,
      )}
      {...rest}
    >
      <Icon name={icon} size={iconSize} />
    </button>
  );
});
