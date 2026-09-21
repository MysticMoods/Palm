import { memo, useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/icons';
import { describeMime } from '../../core/filesystem/mime';
import type { FSNode } from '../../core/filesystem/types';
import { useVirtualRows } from '../../hooks/useVirtualRows';
import { cn } from '../../utils/cn';
import { formatBytes, formatDate } from '../../utils/format';
import { nodeColor, nodeIcon } from './file-icons';
import type { SortDirection, SortKey } from './file-icons';

const ROW_HEIGHT = 30;

export interface ItemEventHandlers {
  onSelect: (node: FSNode, event: React.MouseEvent | React.PointerEvent) => void;
  onOpen: (node: FSNode) => void;
  onContextMenu: (node: FSNode, event: React.MouseEvent) => void;
  onDragStart: (node: FSNode, event: React.DragEvent) => void;
  onDropOnFolder: (node: FSNode, event: React.DragEvent) => void;
  onRenameCommit: (node: FSNode, name: string) => void;
  onRenameCancel: () => void;
}

interface ViewProps extends ItemEventHandlers {
  nodes: FSNode[];
  selection: string[];
  renamingId: string | null;
  cutIds: string[];
}

/* ----------------------------- Inline rename ----------------------------- */

function RenameInput({
  node,
  onCommit,
  onCancel,
  className,
}: {
  node: FSNode;
  onCommit: (name: string) => void;
  onCancel: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(node.name);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const input = ref.current;
      if (!input) return;
      input.focus();
      const dot = node.name.lastIndexOf('.');
      input.setSelectionRange(0, node.kind === 'folder' || dot <= 0 ? node.name.length : dot);
    });
    return () => cancelAnimationFrame(frame);
  }, [node.name, node.kind]);

  return (
    <input
      ref={ref}
      value={value}
      aria-label={`Rename ${node.name}`}
      onChange={(event) => setValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onBlur={() => onCommit(value)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          onCommit(value);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        }
      }}
      className={cn(
        'rounded border border-accent bg-surface px-1 py-0.5 text-[12px] text-ink outline-none',
        className,
      )}
    />
  );
}

/* -------------------------------- Grid view ------------------------------ */

export const GridView = memo(function GridView({
  nodes,
  selection,
  renamingId,
  cutIds,
  onSelect,
  onOpen,
  onContextMenu,
  onDragStart,
  onDropOnFolder,
  onRenameCommit,
  onRenameCancel,
}: ViewProps) {
  return (
    <ul
      role="listbox"
      aria-label="Files"
      aria-multiselectable="true"
      className="grid grid-cols-[repeat(auto-fill,minmax(98px,1fr))] gap-1 p-2"
    >
      {nodes.map((node) => {
        const selected = selection.includes(node.id);
        return (
          <li key={node.id}>
            <div
              role="option"
              aria-selected={selected}
              tabIndex={-1}
              draggable={renamingId !== node.id}
              onDragStart={(event) => onDragStart(node, event)}
              onDragOver={
                node.kind === 'folder'
                  ? (event) => {
                      event.preventDefault();
                      event.currentTarget.dataset.dropping = 'true';
                    }
                  : undefined
              }
              onDragLeave={(event) => {
                delete event.currentTarget.dataset.dropping;
              }}
              onDrop={(event) => {
                delete event.currentTarget.dataset.dropping;
                if (node.kind === 'folder') onDropOnFolder(node, event);
              }}
              onPointerDown={(event) => onSelect(node, event)}
              onDoubleClick={() => onOpen(node)}
              onContextMenu={(event) => onContextMenu(node, event)}
              className={cn(
                'flex cursor-default flex-col items-center gap-1.5 rounded-lg p-2 text-center transition-colors',
                'data-[dropping]:bg-accent/25 data-[dropping]:ring-1 data-[dropping]:ring-accent',
                selected ? 'bg-accent-soft ring-1 ring-accent/50' : 'hover:bg-surface-2',
                cutIds.includes(node.id) && 'opacity-45',
              )}
            >
              <span
                className="flex h-11 w-11 items-center justify-center rounded-xl"
                style={{ backgroundColor: `${nodeColor(node)}24`, color: nodeColor(node) }}
              >
                <Icon name={nodeIcon(node)} size={22} strokeWidth={1.8} />
              </span>
              {renamingId === node.id ? (
                <RenameInput
                  node={node}
                  onCommit={(name) => onRenameCommit(node, name)}
                  onCancel={onRenameCancel}
                  className="w-full text-center"
                />
              ) : (
                <span className="line-clamp-2 w-full break-words text-[11.5px] leading-tight text-ink-2">
                  {node.name}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
});

/* -------------------------------- List view ------------------------------ */

interface ListViewProps extends ViewProps {
  /** Drops the Modified and Type columns when there is no room for them. */
  narrow: boolean;
  sortKey: SortKey;
  sortDirection: SortDirection;
  onSort: (key: SortKey) => void;
}

export const ListView = memo(function ListView({
  nodes,
  selection,
  renamingId,
  cutIds,
  narrow,
  sortKey,
  sortDirection,
  onSort,
  onSelect,
  onOpen,
  onContextMenu,
  onDragStart,
  onDropOnFolder,
  onRenameCommit,
  onRenameCancel,
}: ListViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const range = useVirtualRows(scrollRef, nodes.length, ROW_HEIGHT);
  const visible = nodes.slice(range.start, range.end);

  const columns: Array<{ key: SortKey; label: string; className: string }> = [
    { key: 'name', label: 'Name', className: 'flex-1 min-w-0' },
    { key: 'modified', label: 'Modified', className: cn('w-40 shrink-0', narrow && 'hidden') },
    { key: 'type', label: 'Type', className: cn('w-36 shrink-0', narrow && 'hidden') },
    { key: 'size', label: 'Size', className: 'w-20 shrink-0 text-right' },
  ];

  return (
    <div className="flex h-full flex-col">
      <div
        role="row"
        className="flex shrink-0 items-center gap-3 border-b border-edge/8 bg-surface-2/60 px-3 py-1.5 text-[11px] font-medium text-ink-3"
      >
        {columns.map((column) => (
          <button
            key={column.key}
            type="button"
            onClick={() => onSort(column.key)}
            aria-sort={
              sortKey === column.key ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'
            }
            className={cn(
              'flex items-center gap-1 transition-colors hover:text-ink',
              column.className,
              column.key === 'size' && 'justify-end',
            )}
          >
            {column.label}
            {sortKey === column.key ? (
              <Icon name={sortDirection === 'asc' ? 'ChevronUp' : 'ChevronDown'} size={11} />
            ) : null}
          </button>
        ))}
      </div>

      <div ref={scrollRef} className="os-scroll min-h-0 flex-1 overflow-y-auto">
        <div style={{ height: range.totalHeight, position: 'relative' }}>
          <ul
            role="listbox"
            aria-label="Files"
            aria-multiselectable="true"
            style={{ transform: `translateY(${range.paddingTop}px)` }}
          >
            {visible.map((node) => {
              const selected = selection.includes(node.id);
              return (
                <li key={node.id}>
                  <div
                    role="option"
                    aria-selected={selected}
                    tabIndex={-1}
                    draggable={renamingId !== node.id}
                    onDragStart={(event) => onDragStart(node, event)}
                    onDragOver={
                      node.kind === 'folder'
                        ? (event) => {
                            event.preventDefault();
                            event.currentTarget.dataset.dropping = 'true';
                          }
                        : undefined
                    }
                    onDragLeave={(event) => {
                      delete event.currentTarget.dataset.dropping;
                    }}
                    onDrop={(event) => {
                      delete event.currentTarget.dataset.dropping;
                      if (node.kind === 'folder') onDropOnFolder(node, event);
                    }}
                    onPointerDown={(event) => onSelect(node, event)}
                    onDoubleClick={() => onOpen(node)}
                    onContextMenu={(event) => onContextMenu(node, event)}
                    style={{ height: ROW_HEIGHT }}
                    className={cn(
                      'flex cursor-default items-center gap-3 px-3 text-[12.5px] transition-colors',
                      'data-[dropping]:bg-accent/25',
                      selected ? 'bg-accent-soft text-accent-ink' : 'text-ink-2 hover:bg-surface-2',
                      cutIds.includes(node.id) && 'opacity-45',
                    )}
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <Icon name={nodeIcon(node)} size={15} />
                      {renamingId === node.id ? (
                        <RenameInput
                          node={node}
                          onCommit={(name) => onRenameCommit(node, name)}
                          onCancel={onRenameCancel}
                          className="min-w-0 flex-1"
                        />
                      ) : (
                        <span className="truncate">{node.name}</span>
                      )}
                    </span>
                    <span className={cn('w-40 shrink-0 truncate text-[11.5px] text-ink-3', narrow && 'hidden')}>
                      {formatDate(node.modifiedAt)}
                    </span>
                    <span className={cn('w-36 shrink-0 truncate text-[11.5px] text-ink-3', narrow && 'hidden')}>
                      {describeMime(node.mime)}
                    </span>
                    <span className="w-20 shrink-0 text-right text-[11.5px] tabular-nums text-ink-3">
                      {node.kind === 'folder' ? '—' : formatBytes(node.size)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
});
