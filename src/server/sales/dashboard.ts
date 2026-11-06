import "server-only";
import { database } from "../db";
import { staff, type Actor } from "../operations/core";
import { canView, internalLink } from "../notifications/access";
import { localDay } from "../notifications/time";
import { listNotifications } from "../notifications/service";
export async function dashboard(actor: Actor, view = "all") {
  staff(actor);
  const db = database(),
    now = new Date();
  const owner = actor.role === "admin";
  const [
    notifications,
    orders,
    cases,
    comps,
    transfers,
    purchases,
    expenses,
    job,
  ] = await Promise.all([
    db.notification.findMany({
      where: {
        conditionActive: true,
        status: { in: ["OPEN", "IN_PROGRESS"] },
        actionable: true,
      },
      include: { receipts: true },
    }),
    actor.role === "viewer"
      ? []
      : db.shopOrder.findMany({
          where: { paymentStatus: "PAID", fulfillmentStatus: "UNFULFILLED" },
          select: {
            id: true,
            number: true,
            assigneeId: true,
            paidAt: true,
            exception: true,
          },
        }),
    actor.role === "viewer"
      ? []
      : db.aftercareCase.findMany({
          where: {
            status: { notIn: ["CLOSED", "RESOLVED"] },
            ...(owner ? {} : { assigneeId: actor.id }),
          },
        }),
    actor.role === "viewer"
      ? []
      : db.compensation.findMany({
          where: {
            status: { in: ["SUBMITTED", "APPROVED", "EXECUTING", "FAILED"] },
            ...(owner
              ? {}
              : { executorId: actor.id, case: { assigneeId: actor.id } }),
          },
        }),
    db.transfer.findMany({
      where: { status: { in: ["SENT", "PARTIAL"] } },
      select: { id: true, number: true, etaEnd: true },
    }),
    owner
      ? db.purchase.findMany({
          where: { status: "CONFIRMED" },
          select: { id: true, number: true, assigneeId: true, etaEnd: true },
        })
      : [],
    owner
      ? db.expense.findMany({
          where: {
            status: "OPEN",
            OR: [
              { resultStatus: "PENDING" },
              {
                cash: {
                  none: {
                    status: "CONFIRMED",
                    kind: "PAYMENT",
                    source: "MANUAL",
                  },
                },
              },
            ],
          },
          select: {
            id: true,
            number: true,
            assigneeId: true,
            dueAt: true,
            purchaseId: true,
          },
        })
      : [],
    owner
      ? db.notificationJob.findUnique({ where: { id: "notifications" } })
      : null,
  ]);
  type Task = {
    key: string;
    source: string;
    objectId: string;
    title: string;
    reason: string;
    assigneeId: string | null;
    deadline: Date | null;
    status: string;
    action: string;
    href: string;
    approval?: boolean;
    confirmation?: boolean;
  };
  const tasks = new Map<string, Task>();
  const add = (t: Task) => tasks.set(t.source + ":" + t.objectId, t);
  for (const o of orders)
    add({
      key: "order:" + o.id,
      source: "order",
      objectId: o.id,
      title: o.number,
      reason: o.exception || "Paid order awaiting whole-order dispatch",
      assigneeId: o.assigneeId,
      deadline: null,
      status: "UNFULFILLED",
      action: "Review address and pick / ship",
      href: "/admin/sales?section=orders&id=" + o.id,
    });
  for (const c of cases)
    add({
      key: "case:" + c.id,
      source: "case",
      objectId: c.id,
      title: c.number,
      reason: c.summary,
      assigneeId: c.assigneeId,
      deadline: c.dueAt,
      status: c.status,
      action: "Respond and record progress",
      href: "/admin/sales?section=cases&id=" + c.id,
    });
  for (const c of comps)
    add({
      key: "compensation:" + c.id,
      source: "compensation",
      objectId: c.id,
      title: c.number,
      reason: c.type + " · " + c.basis,
      assigneeId: c.executorId,
      deadline: c.dueAt,
      status: c.status,
      approval: c.status === "SUBMITTED",
      action:
        c.status === "SUBMITTED"
          ? "Review compensation request"
          : "Execute only the authorized action",
      href: "/admin/sales?section=compensations&id=" + c.id,
    });
  for (const t of transfers)
    add({
      key: "transfer:" + t.id,
      source: "transfer",
      objectId: t.id,
      title: t.number,
      reason: "Incoming transfer has remaining acceptance work",
      assigneeId: null,
      deadline: t.etaEnd,
      status: "AWAITING_ACCEPTANCE",
      action: "Inspect actual arrival",
      href: "/admin/operations?section=transfers&id=" + t.id,
    });
  for (const p of purchases)
    add({
      key: "purchase:" + p.id,
      source: "purchase",
      objectId: p.id,
      title: p.number,
      reason: "Confirmed purchase awaiting closure",
      assigneeId: p.assigneeId,
      deadline: p.etaEnd,
      status: "CONFIRMED",
      action: "Review acceptance and remainder",
      href: "/admin/business?section=purchases&id=" + p.id,
    });
  for (const e of expenses.filter(
    (e) => !purchases.some((p) => p.id === e.purchaseId),
  ))
    add({
      key: "expense:" + e.id,
      source: "expense",
      objectId: e.id,
      title: e.number,
      reason: "Payment or expected outcome needs review",
      assigneeId: e.assigneeId,
      deadline: e.dueAt,
      status: "OPEN",
      action: "Review payment and outcome independently",
      href: "/admin/business?section=expenses&id=" + e.id,
    });
  for (const n of notifications.filter((n) => canView(actor, n))) {
    const key = n.objectType + ":" + n.objectId,
      old = tasks.get(key);
    const confirmation =
      n.confirmerIds.includes(actor.id) &&
      !n.receipts.some(
        (r) =>
          r.userId === actor.id && r.version === n.version && r.kind === "ACK",
      );
    if (old) {
      old.reason += " · " + n.reason;
      old.deadline = n.deadlineAt ?? old.deadline;
      old.confirmation = !!old.confirmation || confirmation;
    } else
      add({
        key: "notification:" + n.id,
        source: n.objectType,
        objectId: n.objectId,
        title: n.title,
        reason: n.reason,
        assigneeId: n.assigneeId,
        deadline: n.deadlineAt,
        status: n.status,
        action: n.action,
        href: internalLink(n),
        confirmation,
      });
  }
  if (
    job &&
    (job.lastError ||
      !job.lastSuccessAt ||
      now.getTime() - job.lastSuccessAt.getTime() > 180000)
  )
    add({
      key: "system:job",
      source: "system",
      objectId: "job",
      title: "Background checks need attention",
      reason: job.lastError
        ? "The last run failed"
        : "No successful check within 3 minutes",
      assigneeId: null,
      deadline: null,
      status: "CHECK_TASK",
      action: "Start the local worker or inspect the failed run",
      href: "/admin/notifications?view=rules",
    });
  let items = [...tasks.values()];
  if (view === "mine") items = items.filter((t) => t.assigneeId === actor.id);
  if (view === "approval") items = owner ? items.filter((t) => t.approval) : [];
  if (view === "confirmation") items = items.filter((t) => t.confirmation);
  if (view === "overdue")
    items = items.filter((t) => t.deadline && t.deadline < now);
  if (view === "unassigned") items = items.filter((t) => !t.assigneeId);
  const today = await listNotifications(actor, { view: "today" });
  return {
    role: actor.role,
    timezone: "Australia/Melbourne",
    today: localDay(now, "Australia/Melbourne"),
    items: items.sort(
      (a, b) =>
        (a.deadline?.getTime() ?? Infinity) -
        (b.deadline?.getTime() ?? Infinity),
    ),
    notifications: today,
    total: tasks.size,
    people: await db.user.findMany({
      where: { active: true },
      select: { id: true, name: true },
    }),
  };
}
