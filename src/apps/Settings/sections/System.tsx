import { useEffect, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Notice, Spinner } from '../../../components/ui/Feedback';
import { ConfirmDialog, Modal } from '../../../components/ui/Modal';
import { backupFilename, createBackup, parseBackupFile, restoreBackup } from '../../../core/backup';
import type { ValidationResult } from '../../../core/backup';
import { resetPalmOS } from '../../../core/boot';
import { downloadBlob, pickFilesFallback } from '../../../core/filesystem/local';
import { notifications } from '../../../core/notifications/store';
import { OS_CODENAME, OS_NAME, OS_VERSION } from '../../../core/settings/defaults';
import { estimateStorage } from '../../../core/storage/db';
import { formatBytes, formatDate } from '../../../utils/format';
import { InfoList, Row, Section } from '../Layout';

export function SystemSection() {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pending, setPending] = useState<{ file: File; validation: ValidationResult } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);

  useEffect(() => {
    void estimateStorage().then(setStorage);
  }, []);

  const exportBackup = async () => {
    setExporting(true);
    try {
      const backup = await createBackup();
      downloadBlob(JSON.stringify(backup, null, 2), backupFilename(), 'application/json');
      notifications.push('settings', {
        title: 'Backup exported',
        body: 'Saved through your browser’s downloads.',
      });
    } catch (err) {
      notifications.push('settings', {
        title: 'Could not export backup',
        body: err instanceof Error ? err.message : String(err),
        urgency: 'critical',
      });
    } finally {
      setExporting(false);
    }
  };

  const chooseBackup = async () => {
    const [file] = await pickFilesFallback('application/json,.json', false);
    if (!file) return;
    setImporting(true);
    try {
      const { validation } = await parseBackupFile(file);
      setPending({ file, validation });
    } finally {
      setImporting(false);
    }
  };

  const applyBackup = async () => {
    if (!pending?.validation.valid) return;
    setImporting(true);
    try {
      const { backup } = await parseBackupFile(pending.file);
      await restoreBackup(backup);
      setPending(null);
      // A restore replaces every store's underlying data, so a reload is the
      // only way to guarantee the whole UI reflects it consistently.
      window.location.reload();
    } catch (err) {
      notifications.push('settings', {
        title: 'Could not restore backup',
        body: err instanceof Error ? err.message : String(err),
        urgency: 'critical',
      });
      setImporting(false);
    }
  };

  const browser = describeBrowser();

  return (
    <>
      <Section title="About">
        <InfoList
          rows={[
            ['Operating system', `${OS_NAME} ${OS_VERSION} “${OS_CODENAME}”`],
            ['Build', import.meta.env.MODE],
            ['Browser', browser],
            ['Engine', engineName()],
            ['Platform', navigator.platform || 'not reported'],
            ['Language', navigator.language],
            ['Timezone', Intl.DateTimeFormat().resolvedOptions().timeZone],
            [
              'Storage used',
              storage ? `${formatBytes(storage.usage)} of ${formatBytes(storage.quota)}` : 'not reported',
            ],
          ]}
        />
      </Section>

      <Section
        title="Backup"
        description="Everything Palm OS stores — settings, files and application data — in one JSON file."
      >
        <Row
          label="Export a backup"
          description="Downloads a complete copy of your Palm OS to your computer."
          control={
            <Button variant="secondary" icon="Download" loading={exporting} onClick={exportBackup}>
              Export
            </Button>
          }
        />
        <Row
          label="Import a backup"
          description="Replaces everything currently stored. You will be asked to confirm."
          control={
            <Button variant="secondary" icon="Upload" loading={importing} onClick={chooseBackup}>
              Choose file…
            </Button>
          }
        />
      </Section>

      <Section title="Reset" description="Return Palm OS to how it was the first time you opened it.">
        <Row
          label="Reset Palm OS"
          description="Deletes every file, setting and note stored in this browser. This cannot be undone."
          control={
            <Button variant="danger" icon="RotateCcw" onClick={() => setConfirmReset(true)}>
              Reset
            </Button>
          }
        />
      </Section>

      <Notice tone="neutral" icon="Info" title="Where your data lives">
        Palm OS stores everything in this browser's IndexedDB on this device. Nothing is uploaded, and
        no account is involved. Clearing site data in your browser settings will also erase it.
      </Notice>

      {/* ------------------------------ Import dialog --------------------------- */}
      <Modal
        open={pending !== null}
        onClose={() => setPending(null)}
        title={pending?.validation.valid ? 'Restore this backup?' : 'This backup cannot be restored'}
        icon={pending?.validation.valid ? 'Upload' : 'AlertTriangle'}
        tone={pending?.validation.valid ? 'neutral' : 'danger'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Cancel
            </Button>
            {pending?.validation.valid ? (
              <Button variant="danger" loading={importing} onClick={applyBackup}>
                Replace everything
              </Button>
            ) : null}
          </>
        }
      >
        <div className="flex flex-col gap-3 pb-2">
          {importing ? (
            <div className="flex items-center gap-2 text-ink-3">
              <Spinner size={15} /> <span className="text-xs">Reading backup…</span>
            </div>
          ) : null}

          {pending?.validation.valid && pending.validation.summary ? (
            <>
              <InfoList
                rows={[
                  ['File', pending.file.name],
                  ['Created', formatDate(pending.validation.summary.createdAt)],
                  ['Made with', `Palm OS ${pending.validation.summary.osVersion}`],
                  [
                    'Contains',
                    `${pending.validation.summary.files} files, ${pending.validation.summary.folders} folders`,
                  ],
                ]}
              />
              <Notice tone="warn" icon="AlertTriangle" title="This replaces your current data">
                Every file, setting and note currently in this browser will be discarded. Export a
                backup first if you want to keep them.
              </Notice>
            </>
          ) : pending ? (
            <Notice tone="danger" icon="CircleAlert" title="Validation failed">
              <ul className="ml-4 list-disc">
                {pending.validation.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </Notice>
          ) : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmReset}
        title="Reset Palm OS?"
        description="Every file, folder, note, setting and permission stored in this browser will be permanently deleted."
        confirmLabel="Erase everything"
        destructive
        onConfirm={() => void resetPalmOS()}
        onCancel={() => setConfirmReset(false)}
      />
    </>
  );
}

/** Best-effort browser name. User-agent strings are famously unreliable. */
function describeBrowser(): string {
  const ua = navigator.userAgent;
  const brands = (navigator as Navigator & { userAgentData?: { brands?: Array<{ brand: string; version: string }> } })
    .userAgentData?.brands;
  if (brands?.length) {
    const real = brands.find((brand) => !/not.a.brand/i.test(brand.brand));
    if (real) return `${real.brand} ${real.version}`;
  }
  const match =
    /(Firefox)\/([\d.]+)/.exec(ua) ??
    /(Edg)\/([\d.]+)/.exec(ua) ??
    /(Chrome)\/([\d.]+)/.exec(ua) ??
    /Version\/([\d.]+).*(Safari)/.exec(ua);
  if (!match) return ua.slice(0, 60);
  return match[1] === 'Edg' ? `Edge ${match[2]}` : `${match[1]} ${match[2]}`;
}

function engineName(): string {
  const ua = navigator.userAgent;
  if (ua.includes('Firefox')) return 'Gecko';
  if (ua.includes('Chrome') || ua.includes('Chromium')) return 'Blink';
  if (ua.includes('Safari')) return 'WebKit';
  return 'unknown';
}
