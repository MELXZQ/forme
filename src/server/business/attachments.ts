import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { database } from "../db";
import { HttpError } from "../errors";
import { processImage, type MediaStorage } from "../storage";
import { permit, audit, lock, type Actor } from "./common";
import { parcelPermission } from "./logistics";
function root() {
  return path.resolve(
    /* turbopackIgnore: true */ process.env.STORAGE_DIR || ".local/uploads",
    ".private-business",
  );
}
function file(key: string) {
  if (!/^[a-f0-9-]{36}\.webp$/.test(key))
    throw new HttpError(400, "Invalid attachment key");
  return path.join(/* turbopackIgnore: true */ root(), key);
}
const privateStorage: MediaStorage = {
  async put(bytes) {
    await fs.mkdir(root(), { recursive: true, mode: 0o700 });
    const key = randomUUID() + ".webp";
    await fs.writeFile(file(key), bytes, { flag: "wx", mode: 0o600 });
    return key;
  },
  async read(key) {
    return fs.readFile(/* turbopackIgnore: true */ file(key));
  },
  async remove(key) {
    await fs.unlink(file(key));
  },
};
export async function attachmentPermission(
  actor: Actor,
  type: string,
  id: string,
) {
  const db = database();
  if (type === "expense") {
    await permit(actor, "finance");
    await db.expense.findUniqueOrThrow({ where: { id } });
  } else if (type === "purchase") {
    await permit(actor, "procurement");
    await db.purchase.findUniqueOrThrow({ where: { id } });
  } else if (type === "parcel") {
    const p = await db.parcel.findUniqueOrThrow({ where: { id } });
    await parcelPermission(actor, p);
  } else throw new HttpError(400, "Unsupported attachment source");
}
export async function uploadAttachments(
  actor: Actor,
  type: string,
  id: string,
  files: File[],
) {
  await attachmentPermission(actor, type, id);
  if (!files.length || files.length > 5)
    throw new HttpError(400, "Upload 1–5 image receipts");
  const prepared = await Promise.all(
    files.map(async (f) => ({
      image: await processImage(f),
      name: f.name.slice(0, 200),
    })),
  );
  const stored: string[] = [];
  try {
    for (const item of prepared)
      stored.push(await privateStorage.put(item.image.bytes));
    return await database().$transaction(async (tx) => {
      await lock(tx, `business-attachments:${type}:${id}`);
      if (
        (await tx.businessAttachment.count({
          where: { objectType: type, objectId: id },
        })) +
          files.length >
        20
      )
        throw new HttpError(400, "At most 20 attachments per record");
      const saved = [];
      for (let index = 0; index < prepared.length; index++) {
        const item = prepared[index];
        const a = await tx.businessAttachment.create({
          data: {
            objectType: type,
            objectId: id,
            key: stored[index],
            originalName: item.name,
            mimeType: item.image.mimeType,
            sizeBytes: item.image.sizeBytes,
            uploadedBy: actor.id,
          },
        });
        saved.push({ id: a.id, name: a.originalName });
      }
      await audit(
        tx,
        actor,
        "PRIVATE_EVIDENCE_ADDED",
        type,
        id,
        "Uploaded protected evidence images",
        undefined,
        { attachments: saved },
      );
      return saved;
    });
  } catch (e) {
    await Promise.all(
      stored.map((k) => privateStorage.remove(k).catch(() => {})),
    );
    throw e;
  }
}

export async function downloadAttachment(actor: Actor, id: string) {
  const m = await database().businessAttachment.findUnique({ where: { id } });
  if (!m) throw new HttpError(404, "Attachment not found");
  await attachmentPermission(actor, m.objectType, m.objectId);
  return new Response((await privateStorage.read(m.key)) as BodyInit, {
    headers: {
      "Content-Type": "image/webp",
      "Content-Disposition": `attachment; filename="receipt-${m.id}.webp"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
