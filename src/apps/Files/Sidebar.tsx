import { Icon } from '../../components/icons';
import { DEFAULT_FOLDERS } from '../../core/filesystem/seed';
import { vfs } from '../../core/filesystem/vfs';
import { cn } from '../../utils/cn';
import { DROP_MIME, readDroppedNodes, moveNodesInto } from '../../desktop/dnd';
import type { FilesView } from './types';

interface SidebarProps {
  view: FilesView;
  currentPath: string;
  onNavigate: (path: string) => void;
  onOpenView: (view: FilesView) => void;
  trashCount: number;
  localSupported: boolean;
}

export function Sidebar({
  view,
  currentPath,
  onNavigate,
  onOpenView,
  trashCount,
  localSupported,
}: SidebarProps) {
  return (
    <nav
      aria-label="Places"
      className="os-scroll hidden w-48 shrink-0 overflow-y-auto border-r border-edge/8 bg-surface-2/40 p-2 sm:block"
    >
      <Group label="Palm OS filesystem">
        <Item
          icon="HardDrive"
          label="This Computer"
          active={view === 'files' && currentPath === '/'}
          onClick={() => {
            onOpenView('files');
            onNavigate('/');
          }}
        />
        {DEFAULT_FOLDERS.map((folder) => (
          <Item
            key={folder.name}
            icon={folder.icon}
            label={folder.name}
            active={view === 'files' && currentPath === `/${folder.name}`}
            onClick={() => {
              onOpenView('files');
              onNavigate(`/${folder.name}`);
            }}
            dropTargetPath={`/${folder.name}`}
          />
        ))}
      </Group>

      <Group label="System">
        <Item
          icon="Trash2"
          label="Trash"
          badge={trashCount > 0 ? trashCount : undefined}
          active={view === 'trash'}
          onClick={() => onOpenView('trash')}
        />
      </Group>

      <Group label="Real disk">
        <Item
          icon="Database"
          label="Local Disk"
          active={view === 'local'}
          onClick={() => onOpenView('local')}
        />
        <p className="px-2 pb-1 pt-1 text-[10.5px] leading-snug text-ink-3">
          {localSupported
            ? 'Files on your actual computer. Access must be granted per folder.'
            : 'Your browser cannot grant folder access; import and download are used instead.'}
        </p>
      </Group>
    </nav>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 last:mb-0">
      <h2 className="px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-ink-3">
        {label}
      </h2>
      <ul className="flex flex-col gap-px">{children}</ul>
    </div>
  );
}

function Item({
  icon,
  label,
  active,
  badge,
  onClick,
  dropTargetPath,
}: {
  icon: string;
  label: string;
  active: boolean;
  badge?: number;
  onClick: () => void;
  dropTargetPath?: string;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? 'page' : undefined}
        onDragOver={
          dropTargetPath
            ? (event) => {
                if (!event.dataTransfer.types.includes(DROP_MIME)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                event.currentTarget.dataset.dropping = 'true';
              }
            : undefined
        }
        onDragLeave={
          dropTargetPath
            ? (event) => {
                delete event.currentTarget.dataset.dropping;
              }
            : undefined
        }
        onDrop={
          dropTargetPath
            ? async (event) => {
                event.preventDefault();
                delete event.currentTarget.dataset.dropping;
                const target = vfs.nodeAt(dropTargetPath);
                if (!target) return;
                await moveNodesInto(readDroppedNodes(event.dataTransfer), target.id);
              }
            : undefined
        }
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors',
          'data-[dropping]:bg-accent/25 data-[dropping]:ring-1 data-[dropping]:ring-accent',
          active ? 'bg-accent-soft font-medium text-accent' : 'text-ink-2 hover:bg-surface-3 hover:text-ink',
        )}
      >
        <Icon name={icon} size={14} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {badge !== undefined ? (
          <span className="shrink-0 rounded-full bg-surface-3 px-1.5 text-[10px] tabular-nums text-ink-2">
            {badge}
          </span>
        ) : null}
      </button>
    </li>
  );
}
