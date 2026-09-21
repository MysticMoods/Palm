import { cloneElement, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactElement, ReactNode } from 'react';
import { cn } from '../../utils/cn';

type Side = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps {
  content: ReactNode;
  side?: Side;
  delay?: number;
  children: ReactElement<{
    onPointerEnter?: (e: React.PointerEvent) => void;
    onPointerLeave?: (e: React.PointerEvent) => void;
    onFocus?: (e: React.FocusEvent) => void;
    onBlur?: (e: React.FocusEvent) => void;
    ref?: React.Ref<HTMLElement>;
    'aria-describedby'?: string;
  }>;
  disabled?: boolean;
}

/**
 * Hover/focus tooltip.
 *
 * Shows on keyboard focus as well as pointer hover, and is wired up with
 * `aria-describedby` so the description is announced rather than being a
 * mouse-only affordance.
 */
export function Tooltip({ content, side = 'top', delay = 350, children, disabled }: TooltipProps) {
  const id = useId();
  const anchorRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  const show = () => {
    if (disabled) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const element = anchorRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const gap = 9;
      const map: Record<Side, { left: number; top: number }> = {
        top: { left: rect.left + rect.width / 2, top: rect.top - gap },
        bottom: { left: rect.left + rect.width / 2, top: rect.bottom + gap },
        left: { left: rect.left - gap, top: rect.top + rect.height / 2 },
        right: { left: rect.right + gap, top: rect.top + rect.height / 2 },
      };
      setPosition(map[side]);
    }, delay);
  };

  const hide = () => {
    clearTimeout(timerRef.current);
    setPosition(null);
  };

  const transforms: Record<Side, string> = {
    top: 'translate(-50%, -100%)',
    bottom: 'translate(-50%, 0)',
    left: 'translate(-100%, -50%)',
    right: 'translate(0, -50%)',
  };

  const child = cloneElement(children, {
    ref: (node: HTMLElement | null) => {
      anchorRef.current = node;
      const { ref } = children as unknown as { ref?: React.Ref<HTMLElement> };
      if (typeof ref === 'function') ref(node);
      else if (ref && typeof ref === 'object') (ref as React.RefObject<HTMLElement | null>).current = node;
    },
    onPointerEnter: (event: React.PointerEvent) => {
      children.props.onPointerEnter?.(event);
      if (event.pointerType !== 'touch') show();
    },
    onPointerLeave: (event: React.PointerEvent) => {
      children.props.onPointerLeave?.(event);
      hide();
    },
    onFocus: (event: React.FocusEvent) => {
      children.props.onFocus?.(event);
      show();
    },
    onBlur: (event: React.FocusEvent) => {
      children.props.onBlur?.(event);
      hide();
    },
    'aria-describedby': position ? id : undefined,
  });

  return (
    <>
      {child}
      {position
        ? createPortal(
            <div
              id={id}
              role="tooltip"
              className={cn(
                'anim-fade os-glass-strong pointer-events-none fixed z-[9500] rounded-md px-2 py-1',
                'text-[11.5px] font-medium text-ink shadow-[var(--shadow-pop)] whitespace-nowrap',
              )}
              style={{ left: position.left, top: position.top, transform: transforms[side] }}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
