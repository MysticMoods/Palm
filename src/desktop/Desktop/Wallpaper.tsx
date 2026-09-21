import { memo, useEffect, useState } from 'react';
import { useSetting } from '../../core/settings/store';
import { isVfsWallpaper, vfsWallpaperId, wallpaperStyle } from '../../core/settings/wallpapers';
import { vfs } from '../../core/filesystem/vfs';

/**
 * Desktop background.
 *
 * Filesystem-backed wallpapers need an object URL, which is created here and
 * revoked when the wallpaper changes so blobs are not leaked across changes.
 */
export const Wallpaper = memo(function Wallpaper() {
  const wallpaper = useSetting('wallpaper');
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (wallpaper.kind !== 'image' || !isVfsWallpaper(wallpaper.src)) {
      setObjectUrl(null);
      return;
    }
    let url: string | null = null;
    let cancelled = false;

    vfs
      .createObjectURL(vfsWallpaperId(wallpaper.src))
      .then((created) => {
        if (cancelled) {
          URL.revokeObjectURL(created);
          return;
        }
        url = created;
        setObjectUrl(created);
      })
      .catch(() => setObjectUrl(null));

    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [wallpaper]);

  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 -z-10 bg-canvas transition-[background-color] duration-300"
      style={wallpaperStyle(wallpaper, objectUrl)}
    />
  );
});
