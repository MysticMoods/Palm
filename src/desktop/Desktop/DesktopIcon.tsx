import { memo, useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/icons';
import type { IconSize } from '../../core/settings/types';
import { cn } from '../../utils/cn';
import { CELL, cellToPixels } from './icon-model';
import type { DesktopIconModel } from './icon-model';

interface DesktopIconProps {
  model: DesktopIconModel;
  size: IconSize;
  selected: boolean;
  renaming: boolean;
  onPointerDown: (event: React.PointerEvent, model: DesktopIconModel) => void;
  onOpen: (model: DesktopIconModel) => void;
  onContextMenu: (event: React.MouseEvent, model: DesktopIconModel) => void;
  onRenameCommit: (model: DesktopIconModel, name: string) => void;
  onRenameCancel: () => void;
}

function DesktopIconInner({
  model,
  size,
  selected,
  renaming,
  onPointerDown,
  onOpen,
  onContextMenu,
  onRenameCommit,
  onRenameCancel,
}: DesktopIconProps) {
  const cell = CELL[size];
  const { left, top } = cellToPixels(model.position, size);
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(model.label);

  useEffect(() => {
    if (!renaming) return;
    setDraft(model.label);
    const frame = requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      // Select the stem only, so typing replaces the name but keeps ".txt".
      const dot = model.label.lastIndexOf('.');
      input.setSelectionRange(0, dot > 0 ? dot : model.label.length);
    });
    return () => cancelAnimationFrame(frame);
  }, [renaming, model.label]);

  return (
    <div
      role="option"
      aria-selected={selected}
      aria-label={model.label}
      tabIndex={-1}
      data-icon-key={model.key}
      onPointerDown={(event) => onPointerDown(event, model)}
      onDoubleClick={() => onOpen(model)}
      onContextMenu={(event) => onContextMenu(event, model)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onOpen(model);
        }
      }}
      className={cn(
        'no-select absolute flex flex-col items-center gap-1 rounded-lg p-1.5 text-center',
        'transition-[background-color,box-shadow] duration-100',
        selected ? 'bg-accent/30 ring-1 ring-accent/60' : 'hover:bg-white/10',
      )}
      style={{ left, top, width: cell.width, height: cell.height }}
    >
      <span
        className="relative flex shrink-0 items-center justify-center rounded-xl"
        style={{
          width: cell.icon + 14,
          height: cell.icon + 14,
          backgroundColor: model.color ? `${model.color}2e` : 'rgb(255 255 255 / 0.12)',
          color: model.color ?? '#fff',
        }}
      >
        <Icon name={model.icon} size={cell.icon} strokeWidth={1.7} />
        {model.badge ? (
          <span
            className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-fg"
            aria-label={`${model.badge} items`}
          >
            {model.badge > 99 ? '99+' : model.badge}
          </span>
        ) : null}
      </span>

      {renaming ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onBlur={() => onRenameCommit(model, draft)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Enter') {
              event.preventDefault();
              onRenameCommit(model, draft);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              onRenameCancel();
            }
          }}
          aria-label={`Rename ${model.label}`}
          className="w-full rounded border border-accent bg-surface px-1 py-0.5 text-center text-[11px] text-ink outline-none"
        />
      ) : (
        <span
          className={cn(
            'line-clamp-2 w-full break-words px-0.5 text-[11px] leading-tight text-white',
            'drop-shadow-[0_1px_3px_rgb(0_0_0/0.85)]',
          )}
        >
          {model.label}
        </span>
      )}
    </div>
  );
}

export const DesktopIcon = memo(DesktopIconInner);
