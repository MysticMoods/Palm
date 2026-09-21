import { useMemo } from 'react';
import { Icon } from '../../components/icons';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { describeMime } from '../../core/filesystem/mime';
import { vfs } from '../../core/filesystem/vfs';
import type { FSNode } from '../../core/filesystem/types';
import { formatBytes, formatDate, pluralize } from '../../utils/format';
import { nodeColor, nodeIcon } from './file-icons';

export function PropertiesDialog({ node, onClose }: { node: FSNode | null; onClose: () => void }) {
  const details = useMemo(() => {
    if (!node) return null;
    const size = vfs.sizeOf(node.id);
    const contents = node.kind === 'folder' ? vfs.countWithin(node.id) : null;
    return { size, contents, path: vfs.pathOf(node.id) };
  }, [node]);

  if (!node || !details) return null;

  const rows: Array<[string, string]> = [
    ['Type', describeMime(node.mime)],
    ['Location', details.path.slice(0, details.path.lastIndexOf('/')) || '/'],
    ['Size', node.kind === 'folder' ? `${formatBytes(details.size)} on disk` : formatBytes(node.size)],
  ];

  if (details.contents) {
    rows.push([
      'Contains',
      `${pluralize(details.contents.files, 'file')}, ${pluralize(details.contents.folders, 'folder')}`,
    ]);
  }

  rows.push(
    ['Created', formatDate(node.createdAt)],
    ['Modified', formatDate(node.modifiedAt)],
    ['MIME type', node.mime],
  );

  if (node.system) rows.push(['Attributes', 'System folder — protected from rename and delete']);
  if (node.trash) rows.push(['In Trash since', formatDate(node.trash.deletedAt)]);

  return (
    <Modal
      open
      onClose={onClose}
      title={node.name}
      size="sm"
      footer={
        <Button variant="secondary" onClick={onClose} data-autofocus>
          Close
        </Button>
      }
    >
      <div className="pb-2">
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-edge/10 bg-surface-2 p-3">
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
            style={{ backgroundColor: `${nodeColor(node)}26`, color: nodeColor(node) }}
          >
            <Icon name={nodeIcon(node)} size={22} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium text-ink">{node.name}</p>
            <p className="truncate font-mono text-[11px] text-ink-3">{details.path}</p>
          </div>
        </div>

        <dl className="flex flex-col gap-0">
          {rows.map(([label, value]) => (
            <div
              key={label}
              className="flex items-start justify-between gap-4 border-b border-edge/6 py-2 last:border-b-0"
            >
              <dt className="shrink-0 text-[12px] text-ink-3">{label}</dt>
              <dd className="min-w-0 break-words text-right text-[12px] text-ink-2">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Modal>
  );
}
