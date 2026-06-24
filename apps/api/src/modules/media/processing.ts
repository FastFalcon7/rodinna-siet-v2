import sharp from 'sharp';
import { encode as encodeBlurhash } from 'blurhash';
import { fileTypeFromBuffer } from 'file-type';
import { ALLOWED_IMAGE_MIMES } from '@rodinna/shared-types';

/** Výsledok spracovania obrázka — pripravený na uloženie + DB záznam. */
export interface ProcessedImage {
  data: Buffer;
  mime: string;
  ext: string;
  width: number;
  height: number;
  blurhash: string;
  bytes: number;
}

export interface ProcessOptions {
  /** Max rozmer dlhšej strany (px). Väčšie sa zmenšia, menšie sa nezväčšujú. */
  maxDim?: number;
  /** Štvorcový cover-crop (pre avatary). */
  square?: boolean;
  /** WebP kvalita 1–100. */
  quality?: number;
}

export class UnsupportedMediaError extends Error {}

/**
 * Spracuje nahraný obrázok: overí magic byty, auto-orientuje podľa EXIF,
 * zmenší, re-enkóduje do WebP a tým **odstráni EXIF (vrátane GPS) — §9**,
 * a vygeneruje blurhash placeholder. sharp štandardne metadáta nezachováva,
 * takže re-encode = strip.
 */
export async function processImage(
  input: Buffer | Uint8Array,
  opts: ProcessOptions = {},
): Promise<ProcessedImage> {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);

  // 1. Magic-byte kontrola — nespoliehame sa na deklarovaný Content-Type.
  const ft = await fileTypeFromBuffer(buf);
  if (!ft || !(ALLOWED_IMAGE_MIMES as readonly string[]).includes(ft.mime)) {
    throw new UnsupportedMediaError(
      `Nepodporovaný formát obrázka${ft ? ` (${ft.mime})` : ''}. Povolené: JPEG, PNG, WebP, GIF.`,
    );
  }

  const maxDim = opts.maxDim ?? 2560;
  const quality = opts.quality ?? 82;

  // 2. rotate() bez argumentu = auto-orient podľa EXIF pred stripom.
  let pipeline = sharp(buf, { animated: false }).rotate();

  if (opts.square) {
    pipeline = pipeline.resize(maxDim, maxDim, { fit: 'cover', position: 'attention' });
  } else {
    pipeline = pipeline.resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true });
  }

  // 3. WebP re-encode (strip metadát je default — nevoláme keepMetadata/withMetadata).
  const { data, info } = await pipeline
    .webp({ quality })
    .toBuffer({ resolveWithObject: true });

  // 4. blurhash z malej raw verzie (4×3 komponenty = dobrý pomer kvalita/dĺžka).
  const blurhash = await computeBlurhash(data);

  return {
    data,
    mime: 'image/webp',
    ext: 'webp',
    width: info.width,
    height: info.height,
    blurhash,
    bytes: data.length,
  };
}

/** Vygeneruje blurhash z (už spracovaného) obrázka. */
async function computeBlurhash(image: Buffer): Promise<string> {
  const { data, info } = await sharp(image)
    .raw()
    .ensureAlpha()
    .resize(32, 32, { fit: 'inside' })
    .toBuffer({ resolveWithObject: true });
  return encodeBlurhash(new Uint8ClampedArray(data), info.width, info.height, 4, 3);
}
