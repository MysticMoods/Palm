import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Meter, Notice } from '../../../components/ui/Feedback';
import { ConfirmDialog } from '../../../components/ui/Modal';
import { useFsRevision } from '../../../core/filesystem/useFs';
import { vfs } from '../../../core/filesystem/vfs';
import { notifications } from '../../../core/notifications/store';
import { useNotificationStore } from '../../../core/notifications/store';
import { usePermissionStore } from '../../../core/permissions/store';
import { estimateStorage } from '../../../core/storage/db';
import { forgetLocalDirectory } from '../../../core/filesystem/local';
import { useDesktopStore } from '../../../core/shell/desktop-store';
import { useAppStore } from '../../../core/app-manager/store';
import { formatBytes, pluralize } from '../../../utils/format';
import { InfoList, Row, Section } from '../Layout';

export function StorageSection() {
  const revision = useFsRevision();
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);

  const refresh = useCallback(() => {
    void estimateStorage().then(setEstimate);
  }, []);

  useEffect(() => {
    refresh();
    if (navigator.storage?.persisted) {
      void navigator.storage.persisted().then(setPersisted).catch(() => setPersisted(null));
    }
  }, [refresh, revision]);

  const stats = vfs.stats();
  const trash = vfs.listTrash();
  const trashBytes = vfs.trashSize();

  const requestPersistence = async () => {
    if (!navigator.storage?.persist) return;
    const granted = await navigator.storage.persist().catch(() => false);
    setPersisted(granted);
    notifications.push('settings', {
      title: granted ? 'Storage marked as persistent' : 'Browser declined persistent storage',
      body: granted
        ? 'Your browser will not evict Palm OS data automatically.'
        : 'Browsers usually grant this only to sites you visit often or install.',
      urgency: granted ? 'normal' : 'normal',
    });
  };

  return (
    <>
      <Section title="Browser storage" description="How much space Palm OS is using on this device.">
        <Row stacked>
          {estimate ? (
            <>
              <Meter
                label="Used"
                value={estimate.usage}
                max={Math.max(estimate.quota, 1)}
                valueLabel={`${formatBytes(estimate.usage)} of ${formatBytes(estimate.quota)}`}
                tone={estimate.usage / Math.max(estimate.quota, 1) > 0.85 ? 'warn' : 'accent'}
              />
              <p className="mt-2 text-[11.5px] text-ink-3">
                The quota is set by your browser and shared with everything else this origin stores.
              </p>
            </>
          ) : (
            <p className="text-[12px] text-ink-3">This browser does not report a storage estimate.</p>
          )}
        </Row>
        <Row
          label="Persistent storage"
          description={
            persisted === true
              ? 'Your browser has agreed not to evict Palm OS data automatically.'
              : 'Browsers may clear site data under storage pressure. Requesting persistence reduces that risk.'
          }
          control={
            <Button
              size="sm"
              variant={persisted ? 'ghost' : 'secondary'}
              disabled={persisted === true || !navigator.storage?.persist}
              onClick={requestPersistence}
            >
              {persisted === true ? 'Granted' : 'Request'}
            </Button>
          }
        />
      </Section>

      <Section title="Virtual filesystem">
        <InfoList
          rows={[
            ['Files', String(stats.files)],
            ['Folders', String(stats.folders)],
            ['Total size', formatBytes(stats.bytes)],
          ]}
        />
      </Section>

      <Section title="Trash">
        <Row
          label="Items in the Trash"
          description={`${pluralize(trash.length, 'item')} taking up ${formatBytes(trashBytes)}.`}
          control={
            <Button
              size="sm"
              variant="danger"
              icon="Trash2"
              disabled={trash.length === 0}
              onClick={() => setConfirmEmpty(true)}
            >
              Empty Trash
            </Button>
          }
        />
      </Section>

      <Section title="Temporary data" description="Clear things Palm OS can rebuild without losing your files.">
        <Row
          label="Notification history"
          control={
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                useNotificationStore.getState().clearAll();
                notifications.push('settings', { title: 'Notification history cleared' });
              }}
            >
              Clear
            </Button>
          }
        />
        <Row
          label="Recently used applications"
          control={
            <Button size="sm" variant="ghost" onClick={() => useAppStore.getState().clearRecent()}>
              Clear
            </Button>
          }
        />
        <Row
          label="Desktop icon positions"
          description="Icons return to automatic arrangement."
          control={
            <Button size="sm" variant="ghost" onClick={() => useDesktopStore.getState().resetLayout()}>
              Reset
            </Button>
          }
        />
        <Row
          label="Remembered local folder"
          description="Forget the real folder you granted access to. Your files are untouched."
          control={
            <Button size="sm" variant="ghost" onClick={() => void forgetLocalDirectory()}>
              Forget
            </Button>
          }
        />
        <Row
          label="Application permissions"
          description="Every application will ask again the next time it needs something."
          control={
            <Button size="sm" variant="ghost" onClick={() => usePermissionStore.getState().clear()}>
              Reset all
            </Button>
          }
        />
      </Section>

      <Notice tone="neutral" icon="HardDrive" title="Why IndexedDB">
        Files, settings and application data live in IndexedDB rather than localStorage: it stores
        structured data and binary blobs, handles many megabytes comfortably, and does not block the
        main thread while reading and writing.
      </Notice>

      <ConfirmDialog
        open={confirmEmpty}
        title="Empty the Trash?"
        description={`${pluralize(trash.length, 'item')} will be permanently deleted. This cannot be undone.`}
        confirmLabel="Empty Trash"
        destructive
        onConfirm={async () => {
          setConfirmEmpty(false);
          const count = await vfs.emptyTrash();
          refresh();
          notifications.push('settings', { title: `Deleted ${pluralize(count, 'item')} permanently` });
        }}
        onCancel={() => setConfirmEmpty(false)}
      />
    </>
  );
}
