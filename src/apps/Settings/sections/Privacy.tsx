import { useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Notice } from '../../../components/ui/Feedback';
import { ConfirmDialog } from '../../../components/ui/Modal';
import { resetPalmOS } from '../../../core/boot';
import { launchableApps } from '../../../core/app-manager/registry';
import { notifications } from '../../../core/notifications/store';
import { usePermissionStore } from '../../../core/permissions/store';
import { PERMISSIONS } from '../../../core/permissions/types';
import { appNamespace, kv } from '../../../core/storage/kv';
import { InfoList, Row, Section } from '../Layout';

export function PrivacySection() {
  const grants = usePermissionStore((s) => s.grants);
  const clearPermissions = usePermissionStore((s) => s.clear);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmBrowsing, setConfirmBrowsing] = useState(false);

  const grantRows = Object.entries(grants).flatMap(([appId, appGrants]) => {
    const app = launchableApps().find((candidate) => candidate.id === appId);
    return Object.entries(appGrants ?? {}).map(([permission, decision]) => [
      `${app?.name ?? appId} · ${PERMISSIONS[permission as keyof typeof PERMISSIONS]?.label ?? permission}`,
      decision === 'granted' ? 'Allowed' : 'Blocked',
    ]) as Array<[string, string]>;
  });

  const clearBrowsingData = async () => {
    await kv.clearNamespace(appNamespace('browser'));
    setConfirmBrowsing(false);
    notifications.push('settings', {
      title: 'Browsing data cleared',
      body: 'History, bookmarks and downloads in the Palm OS browser were removed.',
    });
  };

  return (
    <>
      <Section title="What Palm OS stores" description="Everything below is on this device only.">
        <InfoList
          rows={[
            ['Account', 'None — Palm OS has no sign-in'],
            ['Analytics', 'None'],
            ['Telemetry', 'None'],
            ['Network requests', 'Only what you explicitly trigger'],
            ['Storage location', "This browser's IndexedDB"],
          ]}
        />
      </Section>

      <Section title="Granted permissions" description="Decisions you have made for individual applications.">
        {grantRows.length > 0 ? (
          <>
            <InfoList rows={grantRows} />
            <Row
              control={
                <Button size="sm" variant="ghost" icon="RotateCcw" onClick={clearPermissions}>
                  Reset every permission
                </Button>
              }
            />
          </>
        ) : (
          <Row label="No decisions recorded" description="Applications will ask the first time they need something." />
        )}
      </Section>

      <Section title="Clear data">
        <Row
          label="Browsing data"
          description="History, bookmarks and download records in the Palm OS browser."
          control={
            <Button size="sm" variant="secondary" onClick={() => setConfirmBrowsing(true)}>
              Clear
            </Button>
          }
        />
        <Row
          label="Reset Palm OS"
          description="Erase every file, setting and application's data stored in this browser."
          control={
            <Button size="sm" variant="danger" icon="RotateCcw" onClick={() => setConfirmReset(true)}>
              Reset
            </Button>
          }
        />
      </Section>

      <Notice tone="neutral" icon="ShieldCheck" title="What the sandbox guarantees">
        Palm OS runs inside your browser's normal page sandbox. It cannot read your real files unless
        you grant a folder through Files ▸ Local Disk, it never executes downloaded code, and all
        application content is rendered as text rather than HTML, so a file cannot inject script into
        the desktop.
      </Notice>

      <ConfirmDialog
        open={confirmBrowsing}
        title="Clear browsing data?"
        description="History, bookmarks and download records in the Palm OS browser will be deleted."
        confirmLabel="Clear"
        destructive
        onConfirm={() => void clearBrowsingData()}
        onCancel={() => setConfirmBrowsing(false)}
      />

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
