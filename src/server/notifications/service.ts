import "server-only";
import { database } from "../db";
import { command, owner, staff, lock, type Actor } from "../operations/core";
import { HttpError } from "../errors";
import { actionSchema, timezone } from "./validation";
import { canView, redact, validatePeople, internalLink } from "./access";
import { localDay, dateBounds } from "./time";
import { z } from "zod";
import { nonRealRecordIds } from "../business/scope";
const filters = z.object({
  view: z.enum(["today", "all", "unfinished"]).default("today"),
  day: z.string().optional(),
  type: z
    .enum([
      "INVENTORY",
      "PRODUCT",
      "LOGISTICS",
      "SYSTEM",
      "PROCUREMENT",
      "FINANCE",
      "ORDER",
    ])
    .optional(),
  severity: z.coerce.number().int().min(0).max(3).optional(),
  status: z
    .enum(["OPEN", "IN_PROGRESS", "RESOLVED", "NOT_APPLICABLE"])
    .optional(),
  assignee: z.string().max(120).optional(),
  mine: z.enum(["true", "false"]).optional(),
  confirm: z.enum(["true", "false"]).optional(),
  unread: z.enum(["true", "false"]).optional(),
  pinned: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  dataKind: z.enum(["REAL", "TEST"]).optional(),
  objectType: z
    .enum([
      "expense",
      "order",
      "parcel",
      "sku",
      "transfer",
      "case",
      "compensation",
    ])
    .optional(),
});
export async function listNotifications(actor: Actor, input: unknown) {
  staff(actor);
  const q = filters.parse(input);
  const db = database();
  const pref = await db.notificationPreference.findUnique({
    where: { userId: actor.id },
  });
  const zone = timezone.parse(pref?.timezone || "Australia/Melbourne");
  let bounds;
  try {
    bounds = dateBounds(q.day || localDay(new Date(), zone), zone);
  } catch {
    throw new HttpError(400, "Choose a valid calendar date.");
  }
  const rows = await db.notification.findMany({
    include: {
      receipts: { where: { OR: [{ userId: actor.id }, { kind: "ACK" }] } },
    },
    orderBy: [
      { pinned: "desc" },
      { severity: "desc" },
      { createdAt: "desc" },
      { id: "asc" },
    ],
  });
  const scope = q.dataKind ? await nonRealRecordIds() : null;
  const visible = rows.filter(
    (n) =>
      canView(actor, n) &&
      (!q.dataKind ||
        (scope?.get(`${n.objectType}:${n.objectId}`) || "REAL") === q.dataKind),
  );
  const unfinished = visible.filter(
    (n) => n.actionable && ["OPEN", "IN_PROGRESS"].includes(n.status),
  ).length;
  const results = visible.filter(
    (n) =>
      ((q.view !== "today" && !q.day) ||
        n.pinned ||
        (n.createdAt >= bounds.gte && n.createdAt < bounds.lt)) &&
      (q.view !== "unfinished" ||
        (n.actionable && ["OPEN", "IN_PROGRESS"].includes(n.status))) &&
      (!q.type || n.type === q.type) &&
      (!q.objectType || n.objectType === q.objectType) &&
      (q.severity === undefined || n.severity === q.severity) &&
      (!q.status || n.status === q.status) &&
      (!q.assignee || n.assigneeId === q.assignee) &&
      (q.mine !== "true" || n.assigneeId === actor.id) &&
      (q.pinned !== "true" || n.pinned) &&
      (q.unread !== "true" ||
        !n.receipts.some(
          (r) =>
            r.userId === actor.id &&
            r.kind === "READ" &&
            r.version === n.version,
        )) &&
      (q.confirm !== "true" ||
        (n.confirmerIds.includes(actor.id) &&
          !n.receipts.some(
            (r) =>
              r.userId === actor.id &&
              r.kind === "ACK" &&
              r.version === n.version,
          ))),
  );
  const page = Math.min(q.page, Math.max(1, Math.ceil(results.length / 25)));
  const assignees = await db.user.findMany({
    where: {
      id: {
        in: results
          .slice((page - 1) * 25, page * 25)
          .flatMap((n) => (n.assigneeId ? [n.assigneeId] : [])),
      },
    },
    select: { id: true, name: true },
  });
  return {
    items: results.slice((page - 1) * 25, page * 25).map((n) => ({
      ...redact(n, actor),
      unread: !n.receipts.some(
        (r) =>
          r.userId === actor.id && r.kind === "READ" && r.version === n.version,
      ),
      needsConfirmation:
        n.confirmerIds.includes(actor.id) &&
        !n.receipts.some(
          (r) =>
            r.userId === actor.id &&
            r.kind === "ACK" &&
            r.version === n.version,
        ),
      confirmed: n.confirmerIds.filter((id) =>
        n.receipts.some(
          (r) => r.userId === id && r.kind === "ACK" && r.version === n.version,
        ),
      ).length,
      assigneeName:
        assignees.find((a) => a.id === n.assigneeId)?.name || "Unassigned",
      receipts: undefined,
    })),
    total: results.length,
    pinnedTotal: results.filter((n) => n.pinned).length,
    page,
    pageCount: Math.max(1, Math.ceil(results.length / 25)),
    unfinished,
    timezone: zone,
  };
}
export async function notificationDetail(actor: Actor, id: string) {
  staff(actor);
  const db = database();
  const n = await db.notification.findUnique({ where: { id } });
  if (!n || !canView(actor, n))
    throw new HttpError(404, "Notification not found.");
  const [receipts, history, revisions, people] = await Promise.all([
    db.notificationReceipt.findMany({
      where: { notificationId: id },
      orderBy: { createdAt: "asc" },
    }),
    db.notificationHistory.findMany({
      where: { notificationId: id },
      orderBy: { createdAt: "asc" },
    }),
    db.notificationRevision.findMany({
      where: { notificationId: id },
      orderBy: { version: "asc" },
    }),
    db.user.findMany({
      where: {
        id: {
          in: [
            ...n.confirmerIds,
            ...n.recipientIds,
            ...(n.assigneeId ? [n.assigneeId] : []),
          ],
        },
      },
      select: { id: true, name: true, active: true, role: true },
    }),
  ]);
  return {
    ...redact(n, actor),
    timezone:
      (
        await db.notificationPreference.findUnique({
          where: { userId: actor.id },
        })
      )?.timezone || "Australia/Melbourne",
    link: internalLink(n),
    receipts,
    people,
    history:
      actor.role === "admin"
        ? history
        : history.map((h) => ({ ...h, data: {} })),
    revisions:
      actor.role === "admin"
        ? revisions
        : revisions.map((r) => ({ ...r, snapshot: {} })),
  };
}
export async function actNotification(
  actor: Actor,
  id: string,
  input: unknown,
) {
  staff(actor);
  const v = actionSchema.parse(input);
  return command(
    actor,
    "notification-action",
    v.key,
    { id, ...v },
    async (tx) => {
      // Share the scanner lock: version validation and acknowledgments must
      // commit before a material revision can replace the current version.
      await lock(tx, "notification-scan");
      await lock(tx, `notification:${id}`);
      const n = await tx.notification.findUnique({ where: { id } });
      if (!n || !canView(actor, n))
        throw new HttpError(404, "Notification not found.");
      if (n.version !== v.version)
        throw new HttpError(
          409,
          "The notification changed. Read the current version before acting.",
        );
      const ownWork = actor.role === "warehouse" && n.assigneeId === actor.id;
      if (
        !["read", "ack"].includes(v.action) &&
        actor.role !== "admin" &&
        !(ownWork && ["progress", "note"].includes(v.action))
      )
        owner(actor);
      if (v.action === "read" || v.action === "ack") {
        if (v.action === "ack" && !n.confirmerIds.includes(actor.id))
          throw new HttpError(403, "You are not a required confirmer.");
        const kind = v.action === "ack" ? "ACK" : "READ";
        if (
          !(await tx.notificationReceipt.findUnique({
            where: {
              notificationId_userId_version_kind: {
                notificationId: id,
                userId: actor.id,
                version: n.version,
                kind,
              },
            },
          }))
        )
          await tx.notificationReceipt.create({
            data: {
              notificationId: id,
              userId: actor.id,
              version: n.version,
              kind,
            },
          });
      } else if (v.action === "unpin") {
        const acks = await tx.notificationReceipt.findMany({
          where: { notificationId: id, version: n.version, kind: "ACK" },
        });
        if (n.confirmerIds.some((u) => !acks.some((a) => a.userId === u)))
          throw new HttpError(
            409,
            "All designated people must confirm this version first.",
          );
        if (n.systemPin && !["RESOLVED", "NOT_APPLICABLE"].includes(n.status))
          throw new HttpError(
            409,
            "Resolve the exception or close it with a reason before unpinning.",
          );
        await tx.notification.update({
          where: { id },
          data: { pinned: false },
        });
      } else if (v.action === "pin" || v.action === "reassign") {
        const ids = [...new Set(v.confirmerIds || [])];
        if (!ids.length)
          throw new HttpError(400, "Select at least one confirmer.");
        await validatePeople(tx, n.type, n.warehouse, ids);
        if (v.action === "pin" && n.confirmerIds.some((u) => !ids.includes(u)))
          throw new HttpError(
            409,
            "Use explicit Reassign confirmers with a reason to replace the existing list.",
          );
        const changed =
          JSON.stringify([...ids].sort()) !==
          JSON.stringify([...n.confirmerIds].sort());
        const version = n.version + (changed ? 1 : 0);
        await tx.notification.update({
          where: { id },
          data: {
            pinned: true,
            pinReason: v.reason,
            confirmerIds: ids,
            recipientIds: [...new Set([...n.recipientIds, ...ids])],
            version,
          },
        });
        if (changed)
          await tx.notificationRevision.create({
            data: {
              notificationId: id,
              version,
              snapshot: JSON.parse(JSON.stringify(n.currentData)),
              confirmerIds: ids,
              reason: v.reason,
            },
          });
      } else if (v.action === "assign") {
        if (!v.assigneeId) throw new HttpError(400, "Choose an assignee.");
        await validatePeople(tx, n.type, n.warehouse, [v.assigneeId]);
        await tx.notification.update({
          where: { id },
          data: {
            assigneeId: v.assigneeId,
            recipientIds: [...new Set([...n.recipientIds, v.assigneeId])],
          },
        });
      } else if (v.action !== "note")
        await tx.notification.update({
          where: { id },
          data: {
            status:
              v.action === "progress"
                ? "IN_PROGRESS"
                : v.action === "resolve"
                  ? "RESOLVED"
                  : "NOT_APPLICABLE",
          },
        });
      await tx.notificationHistory.create({
        data: {
          notificationId: id,
          actorId: actor.id,
          action: v.action,
          reason: v.reason,
          data: {
            before: {
              status: n.status,
              pinned: n.pinned,
              confirmerIds: n.confirmerIds,
              assigneeId: n.assigneeId,
            },
            ...v,
          },
        },
      });
      return { id };
    },
  );
}
export async function savePreference(actor: Actor, input: unknown) {
  staff(actor);
  const v = z.object({ timezone }).strict().parse(input);
  return database().notificationPreference.upsert({
    where: { userId: actor.id },
    create: { userId: actor.id, ...v },
    update: v,
  });
}
