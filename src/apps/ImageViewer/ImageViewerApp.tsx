import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/icons';
import { IconButton } from '../../components/ui/Button';
import { EmptyState, Spinner } from '../../components/ui/Feedback';
import type { AppProps } from '../../core/app-manager/types';
import { useFsRevision } from '../../core/filesystem/useFs';
import { vfs } from '../../core/filesystem/vfs';
import type { FSNode } from '../../core/filesystem/types';
import { useOS } from '../../desktop/app-context';
import { usePermissionGate } from '../../desktop/use-permission';
import { cn } from '../../utils/cn';
import { clamp } from '../../utils/misc';
import { formatBytes } from '../../utils/format';

const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];

export default function ImageViewerApp({ params }: AppProps<{ path?: string; nodeId?: string }>) {
  const { os } = useOS();
  const revision = useFsRevision();
  const ensureFilesystem = usePermissionGate('filesystem', 'Open images stored in your Palm OS filesystem.');
  const containerRef = useRef<HTMLDivElement>(null);

  const [currentId, setCurrentId] = useState<string | null>(
    params?.nodeId ?? (params?.path ? (vfs.nodeAt(params.path)?.id ?? null) : null),
  );
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [fitMode, setFitMode] = useState<'fit' | 'actual'>('fit');
  const [rotation, setRotation] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);

  const node = currentId ? vfs.getNode(currentId) : null;

  /** Sibling images in the same folder, for previous/next. */
  const siblings = useMemo(() => {
    void revision;
    if (!node?.parentId) return [] as FSNode[];
    return vfs
      .list(node.parentId)
      .filter((candidate) => candidate.kind === 'file' && candidate.mime.startsWith('image/'))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [node?.parentId, revision]);

  const index = siblings.findIndex((candidate) => candidate.id === currentId);

  useEffect(() => {
    if (params?.nodeId) setCurrentId(params.nodeId);
    else if (params?.path) setCurrentId(vfs.nodeAt(params.path)?.id ?? null);
  }, [params?.nodeId, params?.path]);

  /* Object URLs must be revoked, or every image change leaks a blob. */
  useEffect(() => {
    if (!currentId) {
      setUrl(null);
      return;
    }
    const target = vfs.getNode(currentId);
    if (!target) {
      setError('This image no longer exists.');
      setUrl(null);
      return;
    }

    let objectUrl: string | null = null;
    let cancelled = false;
    setLoading(true);
    setError(null);

    void ensureFilesystem()
      .then((granted) => (granted ? vfs.createObjectURL(currentId) : Promise.reject(new Error('Permission to read your files was declined.'))))
      .then((created) => {
        if (cancelled) {
          URL.revokeObjectURL(created);
          return;
        }
        objectUrl = created;
        setUrl(created);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [currentId, ensureFilesystem]);

  useEffect(() => {
    os.window.setTitle(node ? `${node.name} — Image Viewer` : 'Image Viewer');
  }, [node, os]);

  /* Reset the view whenever a different image is shown. */
  useEffect(() => {
    setZoom(1);
    setRotation(0);
    setPan({ x: 0, y: 0 });
    setFitMode('fit');
  }, [currentId]);

  const step = useCallback(
    (delta: -1 | 1) => {
      if (siblings.length === 0) return;
      const next = (index + delta + siblings.length) % siblings.length;
      setCurrentId(siblings[next].id);
    },
    [index, siblings],
  );

  const zoomBy = useCallback((direction: -1 | 1) => {
    setFitMode('actual');
    setZoom((current) => {
      const position = ZOOM_STEPS.findIndex((value) => value >= current - 0.001);
      const nextIndex = clamp(position + direction, 0, ZOOM_STEPS.length - 1);
      return ZOOM_STEPS[nextIndex];
    });
  }, []);

  /* ------------------------------- Interaction ----------------------------- */

  const onWheel = (event: React.WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    zoomBy(event.deltaY < 0 ? 1 : -1);
  };

  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const onPointerDown = (event: React.PointerEvent) => {
    if (fitMode === 'fit' || event.button !== 0) return;
    dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    setPan({ x: drag.panX + (event.clientX - drag.x), y: drag.panY + (event.clientY - drag.y) });
  };

  const onPointerUp = (event: React.PointerEvent) => {
    dragRef.current = null;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        step(1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        step(-1);
        break;
      case '+':
      case '=':
        event.preventDefault();
        zoomBy(1);
        break;
      case '-':
        event.preventDefault();
        zoomBy(-1);
        break;
      case '0':
        event.preventDefault();
        setFitMode('fit');
        setZoom(1);
        setPan({ x: 0, y: 0 });
        break;
      case 'r':
        event.preventDefault();
        setRotation((current) => (current + 90) % 360);
        break;
      case 'f':
        event.preventDefault();
        void toggleFullscreen();
        break;
    }
  };

  const toggleFullscreen = async () => {
    const element = containerRef.current;
    if (!element) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await element.requestFullscreen();
    } catch {
      /* the browser may refuse outside a user gesture */
    }
  };

  if (!node) {
    return (
      <EmptyState
        icon="Image"
        title="No image open"
        description="Open an image from Files, or double-click one on the desktop."
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface" onKeyDown={onKeyDown} tabIndex={-1}>
      {/* -------------------------------- Toolbar ------------------------------ */}
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-edge/8 px-2 py-1.5">
        <IconButton icon="ChevronLeft" label="Previous image" size="sm" disabled={siblings.length < 2} onClick={() => step(-1)} />
        <IconButton icon="ChevronRight" label="Next image" size="sm" disabled={siblings.length < 2} onClick={() => step(1)} />
        <div className="mx-1 h-5 w-px bg-edge/12" aria-hidden="true" />
        <IconButton icon="ZoomOut" label="Zoom out" size="sm" onClick={() => zoomBy(-1)} />
        <span className="w-12 text-center text-[11.5px] tabular-nums text-ink-3">
          {fitMode === 'fit' ? 'Fit' : `${Math.round(zoom * 100)}%`}
        </span>
        <IconButton icon="ZoomIn" label="Zoom in" size="sm" onClick={() => zoomBy(1)} />
        <IconButton
          icon="Maximize2"
          label="Fit to window"
          size="sm"
          active={fitMode === 'fit'}
          onClick={() => {
            setFitMode('fit');
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
        />
        <IconButton
          icon="Grid2x2"
          label="Actual size"
          size="sm"
          active={fitMode === 'actual' && zoom === 1}
          onClick={() => {
            setFitMode('actual');
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
        />
        <div className="mx-1 h-5 w-px bg-edge/12" aria-hidden="true" />
        <IconButton icon="RotateCcw" label="Rotate left" size="sm" onClick={() => setRotation((r) => (r + 270) % 360)} />
        <IconButton icon="RotateCw" label="Rotate right" size="sm" onClick={() => setRotation((r) => (r + 90) % 360)} />
        <IconButton icon="Maximize2" label="Fullscreen" size="sm" onClick={() => void toggleFullscreen()} />

        <span className="mx-2 min-w-0 flex-1 truncate text-center text-[12px] text-ink-2">
          {node.name}
          {siblings.length > 1 ? (
            <span className="text-ink-3"> · {index + 1} of {siblings.length}</span>
          ) : null}
        </span>

        <IconButton
          icon="Palette"
          label="Set as wallpaper"
          size="sm"
          onClick={() => os.settings.set('wallpaper', { kind: 'image', src: `vfs:${node.id}`, fit: 'cover' })}
        />
        <IconButton
          icon="FolderOpen"
          label="Show in Files"
          size="sm"
          onClick={() =>
            os.openApp('files', { params: { path: node.parentId ? vfs.pathOf(node.parentId) : '/' } })
          }
        />
      </div>

      {/* --------------------------------- Canvas ------------------------------- */}
      <div
        ref={containerRef}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => setFitMode(fitMode === 'fit' ? 'actual' : 'fit')}
        className={cn(
          'relative flex min-h-0 flex-1 items-center justify-center overflow-hidden',
          'bg-[repeating-conic-gradient(rgb(var(--os-surface-2))_0_25%,rgb(var(--os-surface-3))_0_50%)] bg-[length:20px_20px]',
          fitMode === 'actual' && 'cursor-grab active:cursor-grabbing',
        )}
      >
        {loading ? (
          <Spinner size={22} />
        ) : error ? (
          <div className="p-6 text-center">
            <Icon name="CircleAlert" size={26} className="mx-auto mb-2 text-danger" />
            <p className="text-[13px] text-ink-2">{error}</p>
          </div>
        ) : url ? (
          <img
            src={url}
            alt={node.name}
            onLoad={(event) =>
              setNatural({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
            draggable={false}
            className={cn(
              'select-none transition-transform duration-150',
              fitMode === 'fit' && 'max-h-full max-w-full object-contain',
            )}
            style={{
              transform:
                fitMode === 'fit'
                  ? `rotate(${rotation}deg)`
                  : `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotation}deg)`,
            }}
          />
        ) : null}
      </div>

      {/* ------------------------------- Status bar ------------------------------ */}
      <div
        role="status"
        className="flex shrink-0 items-center justify-between gap-3 border-t border-edge/8 bg-surface-2/40 px-3 py-1.5 text-[11px] text-ink-3"
      >
        <span>
          {natural ? `${natural.width} × ${natural.height}` : '—'} · {formatBytes(node.size)}
        </span>
        <span>Scroll with Ctrl to zoom · R rotates · F fullscreen · 0 resets</span>
      </div>
    </div>
  );
}
