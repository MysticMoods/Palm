import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/icons';
import { IconButton } from '../../components/ui/Button';
import { EmptyState, Notice } from '../../components/ui/Feedback';
import { Slider } from '../../components/ui/Slider';
import type { AppProps } from '../../core/app-manager/types';
import { categoryForMime } from '../../core/filesystem/mime';
import { useFsRevision } from '../../core/filesystem/useFs';
import { vfs } from '../../core/filesystem/vfs';
import type { FSNode } from '../../core/filesystem/types';
import { useSettingsStore } from '../../core/settings/store';
import { useIsNarrow } from '../../hooks/useElementWidth';
import { useOS } from '../../desktop/app-context';
import { usePermissionGate } from '../../desktop/use-permission';
import { cn } from '../../utils/cn';
import { formatDuration } from '../../utils/format';

export default function MediaPlayerApp({ params }: AppProps<{ path?: string; nodeId?: string }>) {
  const { os } = useOS();
  const revision = useFsRevision();
  const ensureFilesystem = usePermissionGate('filesystem', 'Play audio and video stored in your Palm OS filesystem.');
  const mediaRef = useRef<HTMLVideoElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const narrow = useIsNarrow(rootRef, 680);

  const volume = useSettingsStore((s) => s.settings.volume);
  const muted = useSettingsStore((s) => s.settings.muted);
  const setSetting = useSettingsStore((s) => s.set);

  const [currentId, setCurrentId] = useState<string | null>(
    params?.nodeId ?? (params?.path ? (vfs.nodeAt(params.path)?.id ?? null) : null),
  );
  const [url, setUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [repeat, setRepeat] = useState(false);
  const [shuffle, setShuffle] = useState(false);

  const node = currentId ? vfs.getNode(currentId) : null;
  const isVideo = node ? categoryForMime(node.mime) === 'video' : false;

  /** Everything playable in the same folder, forming an implicit playlist. */
  const playlist = useMemo(() => {
    void revision;
    if (!node?.parentId) return [] as FSNode[];
    return vfs
      .list(node.parentId)
      .filter((candidate) => {
        if (candidate.kind !== 'file') return false;
        const category = categoryForMime(candidate.mime);
        return category === 'audio' || category === 'video';
      })
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [node?.parentId, revision]);

  const index = playlist.findIndex((item) => item.id === currentId);

  useEffect(() => {
    if (params?.nodeId) setCurrentId(params.nodeId);
    else if (params?.path) setCurrentId(vfs.nodeAt(params.path)?.id ?? null);
  }, [params?.nodeId, params?.path]);

  useEffect(() => {
    if (!currentId) {
      setUrl(null);
      return;
    }
    let objectUrl: string | null = null;
    let cancelled = false;
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
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [currentId, ensureFilesystem]);

  useEffect(() => {
    os.window.setTitle(node ? `${node.name} — Media Player` : 'Media Player');
  }, [node, os]);

  /* Volume comes from the system setting so the tray slider controls playback. */
  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    media.volume = Math.min(1, Math.max(0, volume / 100));
    media.muted = muted;
  }, [volume, muted, url]);

  const step = useCallback(
    (delta: -1 | 1) => {
      if (playlist.length === 0) return;
      if (shuffle && playlist.length > 1) {
        let next = index;
        while (next === index) next = Math.floor(Math.random() * playlist.length);
        setCurrentId(playlist[next].id);
        return;
      }
      const next = (index + delta + playlist.length) % playlist.length;
      setCurrentId(playlist[next].id);
    },
    [index, playlist, shuffle],
  );

  const togglePlay = useCallback(() => {
    const media = mediaRef.current;
    if (!media) return;
    if (media.paused) {
      void media.play().catch((err) => {
        // Autoplay restrictions surface here; it is not a decoding failure.
        setError(err instanceof Error ? err.message : String(err));
      });
    } else {
      media.pause();
    }
  }, []);

  if (!node) {
    return (
      <EmptyState
        icon="Film"
        title="Nothing to play"
        description="Open an audio or video file from Files. Palm OS plays whatever formats your browser supports."
        action={
          <button
            type="button"
            onClick={() => os.openApp('files', { params: { path: '/Music' } })}
            className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-fg"
          >
            Open Files
          </button>
        }
      />
    );
  }

  return (
    <div ref={rootRef} className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col bg-surface">
        {/* -------------------------------- Stage ------------------------------- */}
        <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black">
          {url ? (
            <video
              ref={mediaRef}
              key={url}
              src={url}
              controls={false}
              playsInline
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
              onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
              onEnded={() => {
                if (repeat && mediaRef.current) {
                  mediaRef.current.currentTime = 0;
                  void mediaRef.current.play().catch(() => undefined);
                } else if (playlist.length > 1) {
                  step(1);
                } else {
                  setPlaying(false);
                }
              }}
              onError={() =>
                setError(
                  `Your browser cannot decode this file (${node.mime}). Browsers only support a limited set of codecs.`,
                )
              }
              onClick={togglePlay}
              className={cn('max-h-full max-w-full', isVideo ? 'h-full w-full object-contain' : 'hidden')}
            />
          ) : null}

          {!isVideo ? (
            <div className="flex flex-col items-center gap-4 p-8 text-center">
              <span
                className={cn(
                  'flex h-28 w-28 items-center justify-center rounded-3xl bg-accent-soft text-accent-ink',
                  playing && 'anim-pop',
                )}
              >
                <Icon name="Music" size={48} strokeWidth={1.4} />
              </span>
              <div>
                <p className="text-[15px] font-medium text-white">{node.name}</p>
                <p className="mt-0.5 text-[12px] text-white/50">{node.mime}</p>
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="absolute inset-x-4 bottom-4">
              <Notice tone="danger" icon="CircleAlert" title="Playback problem">
                {error}
              </Notice>
            </div>
          ) : null}
        </div>

        {/* ------------------------------- Controls ------------------------------ */}
        <div className="shrink-0 border-t border-edge/8 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="w-11 shrink-0 text-right text-[11px] tabular-nums text-ink-3">
              {formatDuration(time)}
            </span>
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={time}
              aria-label="Playback position"
              aria-valuetext={`${formatDuration(time)} of ${formatDuration(duration)}`}
              onChange={(event) => {
                const media = mediaRef.current;
                if (!media) return;
                media.currentTime = Number(event.target.value);
                setTime(Number(event.target.value));
              }}
              className="os-slider h-5 min-w-0 flex-1 cursor-pointer appearance-none bg-transparent"
              style={{ ['--fill' as string]: `${duration > 0 ? (time / duration) * 100 : 0}%` }}
            />
            <span className="w-11 shrink-0 text-[11px] tabular-nums text-ink-3">
              {formatDuration(duration)}
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1">
            <IconButton icon="Shuffle" label="Shuffle" size="sm" active={shuffle} onClick={() => setShuffle(!shuffle)} />
            <IconButton icon="SkipBack" label="Previous" size="sm" disabled={playlist.length < 2} onClick={() => step(-1)} />
            <IconButton
              icon={playing ? 'Pause' : 'Play'}
              label={playing ? 'Pause' : 'Play'}
              size="lg"
              variant="primary"
              onClick={togglePlay}
            />
            <IconButton icon="SkipForward" label="Next" size="sm" disabled={playlist.length < 2} onClick={() => step(1)} />
            <IconButton icon="Repeat" label="Repeat" size="sm" active={repeat} onClick={() => setRepeat(!repeat)} />

            <div className="mx-2 min-w-0 flex-1 truncate text-[12px] text-ink-2">{node.name}</div>

            <div className="w-32 shrink-0">
              <Slider
                label="Volume"
                hideLabel
                value={muted ? 0 : volume}
                valueLabel={muted ? 'Muted' : `${volume}%`}
                onChange={(value) => {
                  setSetting('volume', value);
                  if (value > 0 && muted) setSetting('muted', false);
                }}
                icon={
                  <button
                    type="button"
                    onClick={() => setSetting('muted', !muted)}
                    aria-label={muted ? 'Unmute' : 'Mute'}
                    className="shrink-0 rounded p-1 text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink"
                  >
                    <Icon name={muted || volume === 0 ? 'VolumeX' : 'Volume2'} size={14} />
                  </button>
                }
              />
            </div>
          </div>
        </div>
      </div>

      {/* ------------------------------- Playlist ------------------------------- */}
      {playlist.length > 1 && !narrow ? (
        <aside
          aria-label="Playlist"
          className="flex w-56 shrink-0 flex-col border-l border-edge/8 bg-surface-2/30"
        >
          <p className="shrink-0 border-b border-edge/8 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
            In this folder · {playlist.length}
          </p>
          <ul className="os-scroll min-h-0 flex-1 overflow-y-auto p-1.5">
            {playlist.map((item, position) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setCurrentId(item.id)}
                  aria-current={item.id === currentId ? 'true' : undefined}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                    item.id === currentId ? 'bg-accent-soft text-accent-ink' : 'text-ink-2 hover:bg-surface-3',
                  )}
                >
                  <Icon
                    name={item.id === currentId && playing ? 'Volume2' : categoryForMime(item.mime) === 'video' ? 'Video' : 'Music'}
                    size={13}
                    className="shrink-0"
                  />
                  <span className="min-w-0 flex-1 truncate text-[12px]">{item.name}</span>
                  <span className="shrink-0 text-[10.5px] text-ink-3">{position + 1}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
      ) : null}
    </div>
  );
}
