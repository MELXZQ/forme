import "server-only";
import { database } from "./db";
import type { Prisma } from "@/generated/prisma/client";
import { storage, processImage } from "./storage";
import { HttpError } from "./errors";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
export function mediaDto(m: {
  id: string;
  alt: string;
  width: number;
  height: number;
  mimeType: string;
  sizeBytes: number;
}) {
  return { ...m, src: `/media/${m.id}` };
}
export async function listAdminMedia() {
  return (
    await database().media.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
    })
  ).map(mediaDto);
}
export async function updateMedia(id: string, input: unknown) {
  const data = z.object({ alt: z.string().max(500) }).parse(input);
  return mediaDto(await database().media.update({ where: { id }, data }));
}
export async function uploadImages(files: File[]) {
  if (files.length < 1 || files.length > 5)
    throw new HttpError(400, "Upload between 1 and 5 images at a time.");
  // Validate the complete batch before persisting any file.
  const processed = await Promise.all(files.map(processImage));
  const keys: string[] = [];
  try {
    const records: Prisma.MediaCreateInput[] = [];
    for (const p of processed) {
      const key = await storage.put(p.bytes);
      keys.push(key);
      records.push({
        storageKey: key,
        source: "local",
        alt: "",
        width: p.width,
        height: p.height,
        sizeBytes: p.sizeBytes,
        mimeType: p.mimeType,
      });
    }
    return await database().$transaction(async (tx) => {
      const result = [];
      for (const data of records)
        result.push(mediaDto(await tx.media.create({ data })));
      return result;
    });
  } catch (e) {
    await Promise.all(keys.map((k) => storage.remove(k).catch(() => {})));
    throw e;
  }
}
export async function deleteMedia(id: string) {
  // PostgreSQL RESTRICT constraints make this safe against concurrent attachment.
  const m = await database().media.delete({ where: { id } });
  if (m.source === "local")
    await storage
      .remove(m.storageKey)
      .catch(() => console.error("Media file cleanup pending", { id }));
}
export async function readableMedia(id: string, admin: boolean) {
  const m = await database().media.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          productImages: {
            where: {
              product: {
                status: "PUBLISHED",
                category: { active: true },
                variants: { some: { enabled: true } },
              },
              OR: [{ variantId: null }, { variant: { enabled: true } }],
            },
          },
          collections: { where: { active: true } },
          desktopSlides: { where: { active: true } },
          mobileSlides: { where: { active: true } },
          desktopModels: true,
          mobileModels: true,
        },
      },
    },
  });
  if (!m || (!admin && !Object.values(m._count).some((n) => n > 0)))
    throw new HttpError(404, "Media not found.");
  if (m.source === "local")
    return { media: m, bytes: await storage.read(m.storageKey) };
  const base = path.resolve("public/images"),
    location = path.resolve(base, m.storageKey);
  if (!location.startsWith(base + path.sep))
    throw new HttpError(404, "Media not found.");
  return { media: m, bytes: await fs.readFile(location) };
}
