import { useState } from 'react';
import { Icon } from '../components/icons';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { usePermissionStore } from '../core/permissions/store';
import { PERMISSIONS } from '../core/permissions/types';

/**
 * Permission prompt.
 *
 * Requests queue up and are shown one at a time. "Remember this decision" is
 * on by default — matching how a real OS behaves — but the user can decide
 * just for this once.
 */
export function PermissionDialog() {
  const request = usePermissionStore((s) => s.queue[0]);
  const resolveTop = usePermissionStore((s) => s.resolveTop);
  const [remember, setRemember] = useState(true);

  if (!request) return null;

  const descriptor = PERMISSIONS[request.permission];

  const decide = (granted: boolean) => {
    resolveTop(granted, remember);
    setRemember(true);
  };

  return (
    <Modal
      open
      onClose={() => decide(false)}
      title={`Allow ${request.appName} to use ${descriptor.label}?`}
      icon={descriptor.icon}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => decide(false)}>
            Don't allow
          </Button>
          <Button variant="primary" onClick={() => decide(true)} data-autofocus>
            Allow
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 pb-1">
        <div className="flex items-center gap-2.5 rounded-lg border border-edge/10 bg-surface-2 p-2.5">
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
            style={{ backgroundColor: `${request.appColor}26`, color: request.appColor }}
          >
            <Icon name={request.appIcon} size={16} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium text-ink">{request.appName}</p>
            <p className="truncate text-[11px] text-ink-3">Palm OS application</p>
          </div>
        </div>

        <p className="text-[13px] leading-relaxed text-ink-2">{descriptor.description}</p>
        {request.reason ? (
          <p className="rounded-lg bg-surface-2 p-2.5 text-[12px] leading-relaxed text-ink-3">
            <span className="font-medium text-ink-2">Why: </span>
            {request.reason}
          </p>
        ) : null}

        {descriptor.browserBacked ? (
          <p className="flex gap-2 text-[11.5px] leading-relaxed text-ink-3">
            <Icon name="Info" size={13} className="mt-px shrink-0" />
            Your browser will ask for its own permission as well. Palm OS cannot grant this on its
            own.
          </p>
        ) : null}

        <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-ink-2">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
            className="h-4 w-4 accent-[rgb(var(--os-accent))]"
          />
          Remember this decision
        </label>
      </div>
    </Modal>
  );
}
