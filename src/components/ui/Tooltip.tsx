import { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';

type Side = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps {
  content: ReactNode;
  side?: Side;
  delay?: number;
  children: ReactNode;
  disabled?: boolean;
}

const TRANSFORMS: Record<Side, string> = {
  top: 'translate(-50%, -100%)',
  bottom: 'translate(-50%, 0)',
  left: 'translate(-100%, -50%)',
  right: 'translate(0, -50%)',
};

/**
 * Hover and focus tooltip.
 *
 * The child is wrapped in a `display: contents` span rather than cloned with a
 * merged ref: the wrapper generates no box of its own, so layout is untouched,
 * while still catching the bubbled pointer and focus events and giving us an
 * element to measure. Cloning would mean overwriting whatever ref the child
 * already had.
 *
 * Shows on keyboard focus as well as hover, and is wired with
 * `aria-describedby` so it is announced rather than being mouse-only.
 */
export function Tooltip({ content, side = 'top', delay = 350, children, disabled }: TooltipProps) {
  const id = useId();
  const wrapperRef = useRef<HTMLSpanElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  const anchorRect = () => {
    const element = wrapperRef.current?.firstElementChild ?? wrapperRef.current;
    return element?.getBoundingClientRect() ?? null;
  };

  const show = () => {
    if (disabled) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const rect = anchorRect();
      if (!rect) return;
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

  return (
    <>
      <span
        ref={wrapperRef}
        style={{ display: 'contents' }}
        aria-describedby={position ? id : undefined}
        onPointerEnter={(event) => {
          if (event.pointerType !== 'touch') show();
        }}
        onPointerLeave={hide}
        onPointerDown={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </span>
      {position
        ? createPortal(
            <div
              id={id}
              role="tooltip"
              className={cn(
                'anim-fade os-glass-strong pointer-events-none fixed z-[9500] rounded-md px-2 py-1',
                'text-[11.5px] font-medium text-ink shadow-[var(--shadow-pop)] whitespace-nowrap',
              )}
              style={{ left: position.left, top: position.top, transform: TRANSFORMS[side] }}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
