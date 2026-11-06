import { z } from "zod";

export const HOME_VERSION = 1;
export const MAX_WIDGETS = 12;
export type HomeActor = { id: string; role: string; capabilities?: string[] };
const warehouse = z.enum(["MELBOURNE", "BEIJING", "BOTH"]);
const size = z.enum(["small", "medium", "large"]);
const common = { id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), size };
const empty = z.object({}).strict();
export const widgetSchema = z.discriminatedUnion("type", [
  z.object({ ...common, type: z.literal("sales"), config: empty }).strict(),
  z.object({ ...common, type: z.literal("dispatch"), config: empty }).strict(),
  z
    .object({
      ...common,
      type: z.literal("inventory"),
      config: z.object({ warehouse }).strict(),
    })
    .strict(),
  z
    .object({ ...common, type: z.literal("notifications"), config: empty })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal("logistics"),
      config: z
        .object({
          type: z.enum([
            "ALL",
            "SUPPLIER_INBOUND",
            "TRANSFER",
            "CUSTOMER_DELIVERY",
            "CUSTOMER_RETURN",
            "REPLACEMENT",
            "SUPPLIER_RETURN",
            "OTHER",
          ]),
        })
        .strict(),
    })
    .strict(),
  z.object({ ...common, type: z.literal("trend"), config: empty }).strict(),
  z.object({ ...common, type: z.literal("expenses"), config: empty }).strict(),
  z.object({ ...common, type: z.literal("receiving"), config: empty }).strict(),
  z
    .object({ ...common, type: z.literal("replacement"), config: empty })
    .strict(),
  z
    .object({ ...common, type: z.literal("stockIssues"), config: empty })
    .strict(),
]);
export type Widget = z.infer<typeof widgetSchema>;
export type WidgetType = Widget["type"];
export type WidgetSize = Widget["size"];
export type Definition = {
  type: WidgetType;
  name: string;
  description: string;
  preview: string;
  sizes: WidgetSize[];
  repeat?: boolean;
  core?: boolean;
};
export const definitions: Definition[] = [
  {
    type: "sales",
    name: "Today’s sales",
    description:
      "Paid merchandise and successful payment orders, in your timezone.",
    preview: "AUD — · — paid orders",
    sizes: ["small"],
  },
  {
    type: "dispatch",
    name: "Awaiting dispatch",
    description: "All paid, unfulfilled orders, including overdue dispatches.",
    preview: "— orders · — overdue",
    sizes: ["small"],
  },
  {
    type: "inventory",
    name: "Stock watch",
    description:
      "Enabled SKUs and the low-stock rules already configured in Stock.",
    preview: "— low stock · — zero available",
    sizes: ["small", "medium"],
    repeat: true,
  },
  {
    type: "notifications",
    name: "Notifications & pinned",
    description:
      "First generated today, plus every still-pinned item from earlier days.",
    preview: "Pinned first · confirmations · people",
    sizes: ["medium", "large"],
    core: true,
  },
  {
    type: "logistics",
    name: "Parcel activity",
    description:
      "Parcel records in transit, due today and unresolved overdue arrivals.",
    preview: "— in transit · — due today",
    sizes: ["small", "medium"],
  },
  {
    type: "trend",
    name: "Last 7 days",
    description:
      "Recorded paid merchandise across seven calendar days, including today.",
    preview: "▂ ▅ ▃ ▆ · daily values, when recorded",
    sizes: ["medium", "large"],
  },
  {
    type: "expenses",
    name: "Upcoming expenses",
    description:
      "Outstanding obligations by currency and unresolved expense alerts.",
    preview: "Today · next 7 days · currencies separate",
    sizes: ["small", "medium"],
  },
  {
    type: "receiving",
    name: "Awaiting receipt",
    description:
      "Incoming transfers with remaining stock to accept in Melbourne.",
    preview: "— transfer records awaiting receipt",
    sizes: ["small"],
  },
  {
    type: "replacement",
    name: "Awaiting replacement",
    description:
      "Approved replacement requests available to you that still need dispatch.",
    preview: "— approved replacement requests",
    sizes: ["small"],
  },
  {
    type: "stockIssues",
    name: "Stock exceptions",
    description: "Melbourne stock discrepancies and pending stock counts.",
    preview: "— affected SKUs · — pending counts",
    sizes: ["small"],
  },
];
export function canWidget(actor: HomeActor, type: WidgetType) {
  const can = (capability: string) =>
    actor.role === "admin" || !!actor.capabilities?.includes(capability);
  if (!["admin", "warehouse", "viewer"].includes(actor.role)) return false;
  if (type === "sales" || type === "trend")
    return actor.role !== "viewer" && can("orderStats");
  if (type === "expenses") return can("finance");
  if (["dispatch", "replacement", "logistics", "receiving"].includes(type))
    return actor.role !== "viewer";
  return true;
}
export function canConfigure(actor: HomeActor, widget: Widget) {
  return (
    canWidget(actor, widget.type) &&
    (widget.type !== "inventory" ||
      actor.role === "admin" ||
      widget.config.warehouse === "MELBOURNE")
  );
}
export function catalogue(actor: HomeActor) {
  return definitions.filter((d) => canWidget(actor, d.type));
}
export function newWidget(type: WidgetType, id: string): Widget {
  const size = definitions.find((d) => d.type === type)!.sizes[0];
  return widgetSchema.parse({
    id,
    type,
    size,
    config:
      type === "inventory"
        ? { warehouse: "MELBOURNE" }
        : type === "logistics"
          ? { type: "ALL" }
          : {},
  });
}
export function defaultLayout(actor: HomeActor): Widget[] {
  const types: WidgetType[] =
    actor.role === "admin"
      ? [
          "sales",
          "dispatch",
          "inventory",
          "notifications",
          "logistics",
          "trend",
          "expenses",
        ]
      : actor.role === "warehouse"
        ? [
            "receiving",
            "dispatch",
            "replacement",
            "stockIssues",
            "notifications",
          ]
        : ["inventory", "stockIssues", "notifications"];
  const result = types
    .filter((type) => canWidget(actor, type))
    .map((type) => newWidget(type, `default-${type}`));
  // Explicit additional grants do not silently change a warehouse user's defaults.
  return result;
}
export const widgetsSchema = z
  .array(widgetSchema)
  .min(1)
  .max(MAX_WIDGETS)
  .superRefine((widgets, ctx) => {
    const ids = new Set<string>(),
      types = new Set<string>();
    for (const [i, w] of widgets.entries()) {
      const d = definitions.find((d) => d.type === w.type)!;
      if (
        ids.has(w.id) ||
        (!d.repeat && types.has(w.type)) ||
        !d.sizes.includes(w.size)
      )
        ctx.addIssue({
          code: "custom",
          path: [i],
          message: "Duplicate widget or unsupported size.",
        });
      ids.add(w.id);
      types.add(w.type);
    }
  });
export const layoutSchema = z
  .object({
    version: z.literal(HOME_VERSION),
    revision: z.number().int().min(0),
    widgets: widgetsSchema,
  })
  .strict()
  .refine(
    (v) => v.widgets.some((w) => w.type === "notifications"),
    "Keep the notifications widget.",
  );
export function recoverLayout(raw: unknown, version: number, actor: HomeActor) {
  if (version !== HOME_VERSION || !Array.isArray(raw))
    return { widgets: defaultLayout(actor), recovered: raw != null };
  const result: Widget[] = [];
  for (const value of raw.slice(0, MAX_WIDGETS)) {
    const item = widgetSchema.safeParse(value);
    if (!item.success || !canConfigure(actor, item.data)) continue;
    if (widgetsSchema.safeParse([...result, item.data]).success)
      result.push(item.data);
  }
  if (!result.some((w) => w.type === "notifications")) {
    if (result.length === MAX_WIDGETS) result.pop();
    let id = "core-notifications";
    while (result.some((w) => w.id === id)) id += "-1";
    result.push(newWidget("notifications", id));
  }
  return {
    widgets: result,
    recovered: JSON.stringify(result) !== JSON.stringify(raw),
  };
}
export type HomeMetric = {
  key: string;
  label: string;
  value: number | null;
  href: string;
  currency?: string;
  unit?: string;
  attention?: boolean;
  emptyLabel?: string;
};
export type HomePoint = {
  day: string;
  value: number | null;
  orders: number;
  href: string;
};
export type HomeNotice = {
  id: string;
  title: string;
  reason: string;
  type: string;
  severity: number;
  createdAt: string;
  pinned: boolean;
  assignee: string;
  confirmed: number;
  required: number;
};
export type HomePayload = {
  metrics: HomeMetric[];
  note: string;
  incomplete?: string;
  empty?: string;
  trend?: HomePoint[];
  notifications?: {
    items: HomeNotice[];
    total: number;
    hiddenPinned: number;
    href: string;
  };
};
export type HomeResult = {
  id: string;
  status: "success" | "empty" | "incomplete" | "error" | "forbidden";
  updatedAt?: string;
  data?: HomePayload;
  error?: string;
};
export type HomeMeta = {
  actor: HomeActor;
  timezone: "Australia/Melbourne" | "Asia/Shanghai";
  today: string;
  now: string;
  testWorkspace: boolean;
  version: number;
  revision: number;
  widgets: Widget[];
  defaults: Widget[];
  catalogue: Definition[];
  recovered: boolean;
};
