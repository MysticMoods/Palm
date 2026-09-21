import { memo } from 'react';
import { Icon } from '../../components/icons';
import { Tooltip } from '../../components/ui/Tooltip';
import type { AppDefinition } from '../../core/app-manager/types';
import type { WindowState } from '../../core/window-manager/types';
import { cn } from '../../utils/cn';

export interface TaskbarItemProps {
  app: AppDefinition;
  windows: WindowState[];
  focused: boolean;
  vertical: boolean;
  onActivate: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
}

/**
 * One taskbar button.
 *
 * Running state is shown by an indicator bar *and* announced via
 * `aria-label`, so it does not rely on a coloured pip alone.
 */
function TaskbarItemInner({
  app,
  windows,
  focused,
  vertical,
  onActivate,
  onContextMenu,
}: TaskbarItemProps) {
  const running = windows.length > 0;
  const state = !running
    ? 'not running'
    : focused
      ? `${windows.length} window${windows.length === 1 ? '' : 's'}, active`
      : `${windows.length} window${windows.length === 1 ? '' : 's'}, running`;

  return (
    <Tooltip content={app.name} side={vertical ? 'right' : 'top'}>
      <button
        type="button"
        onClick={onActivate}
        onContextMenu={onContextMenu}
        aria-label={`${app.name} — ${state}`}
        aria-pressed={focused}
        className={cn(
          'group relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
          'transition-[background-color,transform] duration-150',
          focused ? 'bg-white/14' : 'hover:bg-white/10 active:scale-95',
        )}
      >
        <span
          className="flex h-7 w-7 items-center justify-center rounded-[7px] transition-transform duration-150 group-active:scale-90"
          style={{ backgroundColor: `${app.color}2e`, color: app.color }}
        >
          <Icon name={app.icon} size={16} strokeWidth={2} />
        </span>

        {running ? (
          <span
            aria-hidden="true"
            className={cn(
              'absolute rounded-full bg-accent-ink transition-all duration-200',
              vertical
                ? cn('left-0.5 w-[3px]', focused ? 'h-5' : 'h-2')
                : cn('bottom-0.5 h-[3px]', focused ? 'w-5' : 'w-2'),
            )}
          />
        ) : null}
      </button>
    </Tooltip>
  );
}

export const TaskbarItem = memo(TaskbarItemInner);
