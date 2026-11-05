import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { HttpError } from "./errors";
export interface MediaStorage {
  put(bytes: Uint8Array): Promise<string>;
  read(key: string): Promise<Uint8Array>;
  remove(key: string): Promise<void>;
}
function root() {
  // Runtime persistent storage is intentionally external to the application build.
  return path.resolve(
    /* turbopackIgnore: true */ process.env.STORAGE_DIR || ".local/uploads",
  );
}
function file(key: string) {
  if (!/^[a-f0-9-]{36}\.webp$/.test(key))
    throw new HttpError(400, "Invalid media key.");
  return path.join(/* turbopackIgnore: true */ root(), key);
}
export const storage: MediaStorage = {
  async put(bytes) {
    await fs.mkdir(root(), { recursive: true, mode: 0o700 });
    const key = `${randomUUID()}.webp`;
    await fs.writeFile(file(key), bytes, { flag: "wx", mode: 0o600 });
    return key;
  },
  async read(key) {
    return fs.readFile(/* turbopackIgnore: true */ file(key));
  },
  async remove(key) {
    await fs.unlink(file(key)).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
  },
};
export async function processImage(file: File) {
  if (!file.size || file.size > 8 * 1024 * 1024)
    throw new HttpError(400, "Each image must be between 1 byte and 8 MB.");
  const bytes = Buffer.from(await file.arrayBuffer());
  try {
    const input = sharp(bytes, {
      limitInputPixels: 30_000_000,
      failOn: "warning",
    });
    const meta = await input.metadata();
    const types: Record<string, string> = {
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
    };
    if (
      !meta.format ||
      !types[meta.format] ||
      !meta.width ||
      !meta.height ||
      (meta.pages || 1) > 1
    )
      throw new HttpError(
        400,
        "Only non-animated JPEG, PNG and WebP images are supported. SVG is not accepted.",
      );
    if (file.type && file.type !== types[meta.format])
      throw new HttpError(
        400,
        "The file contents do not match its declared image type.",
      );
    const result = await input
      .rotate()
      .resize({
        width: 4096,
        height: 4096,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 88 })
      .toBuffer({ resolveWithObject: true });
    return {
      bytes: result.data,
      width: result.info.width,
      height: result.info.height,
      sizeBytes: result.data.length,
      mimeType: "image/webp",
    };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(
      400,
      "This image is invalid, too large, or cannot be decoded.",
    );
  }
}
