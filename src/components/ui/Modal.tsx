import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { cn } from '../../utils/cn';
import { Icon } from '../icons';
import { Button } from './Button';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  icon?: string;
  /** Tint for the header icon and primary action. */
  tone?: 'neutral' | 'danger' | 'warn';
  size?: 'sm' | 'md' | 'lg';
  /** Prevent closing on backdrop click / Escape (destructive confirmations). */
  dismissible?: boolean;
}

/**
 * Modal dialog rendered into a portal above every window.
 *
 * Focus is trapped while open and returned to the trigger on close, and
 * Escape dismisses unless the dialog is explicitly non-dismissible.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  icon,
  tone = 'neutral',
  size = 'sm',
  dismissible = true,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useFocusTrap(panelRef, open);

  useEffect(() => {
    if (!open || !dismissible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, dismissible, onClose]);

  if (!open) return null;

  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' };
  const tones = {
    neutral: 'bg-accent-soft text-accent-ink',
    danger: 'bg-danger/15 text-danger',
    warn: 'bg-warn/15 text-warn',
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[9000] flex items-center justify-center p-4"
      role="presentation"
      onPointerDown={(event) => {
        if (dismissible && event.target === event.currentTarget) onClose();
      }}
    >
      <div className="anim-fade absolute inset-0 bg-black/45 backdrop-blur-[2px]" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          'anim-pop relative w-full overflow-hidden rounded-xl border border-edge/12',
          'bg-surface shadow-[var(--shadow-panel)] outline-none',
          widths[size],
        )}
      >
        <div className="flex items-start gap-3 p-5 pb-3">
          {icon ? (
            <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', tones[tone])}>
              <Icon name={icon} size={18} />
            </span>
          ) : null}
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-[15px] font-semibold leading-tight text-ink">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="mt-1 text-[13px] leading-relaxed text-ink-2">
                {description}
              </p>
            ) : null}
          </div>
          {dismissible ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="-mr-1 -mt-1 rounded-md p-1.5 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <Icon name="X" size={15} />
            </button>
          ) : null}
        </div>

        {children ? <div className="os-scroll max-h-[60vh] overflow-y-auto px-5 pb-1">{children}</div> : null}

        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-edge/8 bg-surface-2/40 px-5 py-3.5">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      icon={destructive ? 'AlertTriangle' : 'CircleHelp'}
      tone={destructive ? 'danger' : 'neutral'}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? 'danger' : 'primary'} onClick={onConfirm} data-autofocus>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}
