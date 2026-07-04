import { useRef, useState } from 'react';
import type { MediaPublic } from '@rodinna/shared-types';
import { ApiError, mediaApi } from '../lib/api';

export interface UploadItem {
  key: string;
  name: string;
  /** Odhad z File.type — len pre lokálny preview, server rozhoduje podľa magic bytov. */
  previewKind: 'image' | 'video' | 'file';
  /** Object URL pre okamžitý náhľad obrázka/videa. */
  localUrl: string | null;
  progress: number;
  media: MediaPublic | null;
  error: string | null;
}

/**
 * Fronta uploadov s progresom (XHR) pre composery. Každý súbor sa nahráva
 * hneď po pridaní; item drží lokálny preview, % progresu a po dokončení
 * MediaPublic zo servera.
 */
export function useMediaUpload(max = 10) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const counter = useRef(0);

  const patch = (key: string, p: Partial<UploadItem>) =>
    setItems((cur) => cur.map((i) => (i.key === key ? { ...i, ...p } : i)));

  const addFiles = (files: File[] | FileList) => {
    const list = Array.from(files);
    setItems((cur) => {
      const room = Math.max(0, max - cur.length);
      const accepted = list.slice(0, room);
      const next: UploadItem[] = accepted.map((file) => {
        const key = `u${++counter.current}`;
        const previewKind = file.type.startsWith('image/')
          ? 'image'
          : file.type.startsWith('video/')
            ? 'video'
            : 'file';
        const localUrl = previewKind === 'file' ? null : URL.createObjectURL(file);

        void mediaApi
          .uploadWithProgress(file, (pct) => patch(key, { progress: pct }))
          .then((media) => patch(key, { media, progress: 100 }))
          .catch((err) =>
            patch(key, { error: err instanceof ApiError ? err.message : 'Nahranie zlyhalo' }),
          );

        return { key, name: file.name, previewKind, localUrl, progress: 0, media: null, error: null };
      });
      return [...cur, ...next];
    });
  };

  const remove = (key: string) =>
    setItems((cur) => {
      const item = cur.find((i) => i.key === key);
      if (item?.localUrl) URL.revokeObjectURL(item.localUrl);
      return cur.filter((i) => i.key !== key);
    });

  const clear = () =>
    setItems((cur) => {
      for (const i of cur) if (i.localUrl) URL.revokeObjectURL(i.localUrl);
      return [];
    });

  const uploading = items.some((i) => !i.media && !i.error);
  const mediaIds = items.filter((i) => i.media).map((i) => i.media!.id);

  return { items, addFiles, remove, clear, uploading, mediaIds };
}
