import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../utils/cn';
import type { ContextMenuItem } from '../../core/shell/store';
import { Icon } from '../icons';

const MENU_WIDTH = 224;
const ITEM_HEIGHT = 30;
const SEPARATOR_HEIGHT = 7;
const PADDING = 6;
const MARGIN = 8;

function estimateHeight(items: ContextMenuItem[]): number {
  return (
    PADDING * 2 +
    items.reduce((sum, item) => sum + (item.separator ? SEPARATOR_HEIGHT : ITEM_HEIGHT), 0)
  );
}

/** Keep the menu fully on screen, flipping above/left of the anchor if needed. */
function fit(x: number, y: number, width: number, height: number) {
  const maxX = window.innerWidth - MARGIN;
  const maxY = window.innerHeight - MARGIN;
  return {
    left: Math.max(MARGIN, x + width > maxX ? Math.max(MARGIN, x - width) : x),
    top: Math.max(MARGIN, y + height > maxY ? Math.max(MARGIN, maxY - height) : y),
  };
}

export interface MenuSurfaceProps {
  items: ContextMenuItem[];
  x: number;
  y: number;
  onClose: () => void;
  label?: string;
  /** Nested menus render inline rather than in their own portal. */
  nested?: boolean;
}

/**
 * Menu surface used for desktop context menus, window menus and app dropdowns.
 *
 * Implements the roving-focus pattern: arrow keys move between items, Home/End
 * jump to the ends, Escape closes, and typing a letter jumps to a match.
 */
export function MenuSurface({ items, x, y, onClose, label = 'Menu', nested = false }: MenuSurfaceProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(() => fit(x, y, MENU_WIDTH, estimateHeight(items)));
  const [activeIndex, setActiveIndex] = useState(-1);
  const [openSubmenu, setOpenSubmenu] = useState<{ index: number; x: number; y: number } | null>(null);

  const selectable = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !item.separator && !item.disabled);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    setPosition(fit(x, y, rect.width, rect.height));
  }, [x, y, items]);

  useEffect(() => {
    if (nested) return;
    const frame = requestAnimationFrame(() => ref.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [nested]);

  // Close when the surface behind the menu scrolls or the window resizes,
  // since the anchor point would otherwise be stale.
  useEffect(() => {
    if (nested) return;
    const close = () => onClose();
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, [nested, onClose]);

  const activate = (item: ContextMenuItem) => {
    if (item.disabled || item.separator) return;
    if (item.items?.length) return;
    onClose();
    item.onSelect?.();
  };

  const move = (delta: number) => {
    if (selectable.length === 0) return;
    const current = selectable.findIndex((entry) => entry.index === activeIndex);
    const next = (current + delta + selectable.length) % selectable.length;
    setActiveIndex(selectable[next].index);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        move(-1);
        break;
      case 'Home':
        event.preventDefault();
        if (selectable[0]) setActiveIndex(selectable[0].index);
        break;
      case 'End':
        event.preventDefault();
        if (selectable.length) setActiveIndex(selectable[selectable.length - 1].index);
        break;
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const item = items[activeIndex];
        if (item?.items?.length) {
          const rect = ref.current?.getBoundingClientRect();
          if (rect) setOpenSubmenu({ index: activeIndex, x: rect.right - 4, y: rect.top });
        } else if (item) {
          activate(item);
        }
        break;
      }
      case 'ArrowRight': {
        const item = items[activeIndex];
        if (item?.items?.length) {
          event.preventDefault();
          const rect = ref.current?.getBoundingClientRect();
          if (rect) setOpenSubmenu({ index: activeIndex, x: rect.right - 4, y: rect.top });
        }
        break;
      }
      case 'ArrowLeft':
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        onClose();
        break;
      default:
        // Type-ahead: jump to the next item starting with the typed letter.
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          const letter = event.key.toLowerCase();
          const start = selectable.findIndex((entry) => entry.index === activeIndex) + 1;
          const ordered = [...selectable.slice(start), ...selectable.slice(0, start)];
          const match = ordered.find((entry) => entry.item.label?.toLowerCase().startsWith(letter));
          if (match) setActiveIndex(match.index);
        }
    }
  };

  const surface = (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      aria-orientation="vertical"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={cn(
        'anim-pop os-glass-strong fixed z-[8500] min-w-[13rem] max-w-[20rem] rounded-lg p-1.5',
        'shadow-[var(--shadow-pop)] outline-none',
      )}
      style={{ left: position.left, top: position.top }}
    >
      {items.map((item, index) => {
        if (item.separator) {
          return <div key={item.id} role="separator" className="my-1 h-px bg-edge/10" />;
        }
        const hasSubmenu = Boolean(item.items?.length);
        const active = index === activeIndex;
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            aria-haspopup={hasSubmenu || undefined}
            aria-expanded={hasSubmenu ? openSubmenu?.index === index : undefined}
            aria-disabled={item.disabled || undefined}
            disabled={item.disabled}
            onPointerEnter={(event) => {
              setActiveIndex(index);
              if (hasSubmenu) {
                const rect = (event.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
                setOpenSubmenu({ index, x: rect.right - 4, y: event.currentTarget.getBoundingClientRect().top - 6 });
              } else {
                setOpenSubmenu(null);
              }
            }}
            onClick={() => activate(item)}
            className={cn(
              'flex h-[30px] w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px]',
              'transition-colors duration-100 disabled:opacity-40 disabled:pointer-events-none',
              active ? 'bg-accent text-accent-fg' : 'text-ink',
              item.danger && !active && 'text-danger',
            )}
          >
            <span className="flex w-4 shrink-0 justify-center">
              {item.checked ? (
                <Icon name="Check" size={13} />
              ) : item.icon ? (
                <Icon name={item.icon} size={14} />
              ) : null}
            </span>
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.hint ? (
              <span className={cn('shrink-0 text-[11px]', active ? 'opacity-75' : 'text-ink-3')}>
                {item.hint}
              </span>
            ) : null}
            {hasSubmenu ? <Icon name="ChevronRight" size={13} className="shrink-0" /> : null}
          </button>
        );
      })}

      {openSubmenu && items[openSubmenu.index]?.items?.length ? (
        <MenuSurface
          nested
          items={items[openSubmenu.index].items!}
          x={openSubmenu.x}
          y={openSubmenu.y}
          onClose={onClose}
          label={items[openSubmenu.index].label ?? 'Submenu'}
        />
      ) : null}
    </div>
  );

  return nested ? surface : createPortal(surface, document.body);
}
