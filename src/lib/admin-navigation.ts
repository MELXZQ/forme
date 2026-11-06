export type AdminLink = { label: string; href: string };
export type AdminGroup = { id: string; label: string; links: AdminLink[] };

// Navigation only; each page/API continues to enforce its own permissions.
export function adminGroups(
  role: string,
  capabilities: string[] = [],
): AdminGroup[] {
  const owner = role === "admin",
    orders = role !== "viewer";
  const can = (cap: string) => owner || capabilities.includes(cap);
  const sales = (section: string, label: string) => ({
    label,
    href: `/admin/sales?section=${section}`,
  });
  const ops = (section: string, label: string) => ({
    label,
    href: `/admin/operations?section=${section}`,
  });
  const business = (section: string, label: string) => ({
    label,
    href: `/admin/business?section=${section}`,
  });
  return [
    {
      id: "work",
      label: "Workspace",
      links: [
        { label: "Home", href: "/admin" },
        ...(orders ? [sales("home", "My work")] : []),
        { label: "Today & pinned", href: "/admin/notifications" },
        { label: "All notifications", href: "/admin/notifications?view=all" },
        { label: "Open tasks", href: "/admin/notifications?view=unfinished" },
        {
          label: "To confirm",
          href: "/admin/notifications?view=all&confirm=true",
        },
        {
          label: "Assigned to me",
          href: "/admin/notifications?view=all&mine=true",
        },
      ],
    },
    {
      id: "orders",
      label: "Orders",
      links: orders
        ? [
            sales("orders", "Order search"),
            ops("orders", "Fulfillment"),
            sales("cases", "Aftercare"),
            sales("compensations", "Compensation"),
          ]
        : [],
    },
    {
      id: "inventory",
      label: "Inventory",
      links: [
        ops("inventory", "Stock"),
        ops("transfers", "Transfers"),
        ops("counts", "Stock counts"),
        business("logistics", "Logistics"),
        ...(owner ? [ops("history", "Inventory history")] : []),
      ],
    },
    {
      id: "purchasing",
      label: "Purchasing",
      links: can("procurement")
        ? [
            business("purchases", "Purchases"),
            business("suppliers", "Suppliers"),
          ]
        : [],
    },
    {
      id: "finance",
      label: "Finance",
      links: [
        ...(can("orderStats") && orders
          ? [sales("analytics", "Sales & cash")]
          : []),
        ...(can("finance") ? [business("expenses", "Expenses")] : []),
        ...(can("recurring") && can("finance")
          ? [business("recurring", "Recurring expenses")]
          : []),
      ],
    },
    {
      id: "catalogue",
      label: "Catalogue",
      links: owner
        ? [
            ...["products", "categories", "collections", "media", "home"].map(
              (section) => ({
                label:
                  section === "home"
                    ? "Homepage"
                    : section[0].toUpperCase() + section.slice(1),
                href: `/admin?catalogue=1&section=${section}`,
              }),
            ),
            sales("campaigns", "Deals associations"),
          ]
        : [],
    },
    {
      id: "settings",
      label: "Settings",
      links: [
        ...(owner
          ? [
              ops("accounts", "Accounts"),
              business("grants", "Permissions"),
              ops("settings", "Store settings"),
              {
                label: "Notification rules",
                href: "/admin/notifications?view=rules",
              },
            ]
          : []),
        ...(can("orderRules") && orders
          ? [sales("rules", "Order timeout rules")]
          : []),
      ],
    },
  ].filter((group) => group.links.length);
}

export function adminLocation(pathname: string, query: string): string {
  const params = new URLSearchParams(query);
  if (pathname === "/admin")
    return params.get("catalogue") === "1"
      ? `/admin?catalogue=1&section=${params.get("section") || "products"}`
      : "/admin";
  if (pathname === "/admin/notifications") {
    const view = params.get("view") || "today";
    if (view === "today") return pathname;
    return `${pathname}?view=${view}${params.get("confirm") === "true" ? "&confirm=true" : params.get("mine") === "true" ? "&mine=true" : ""}`;
  }
  const defaults: Record<string, string> = {
    "/admin/sales": "home",
    "/admin/business": "purchases",
    "/admin/operations": "inventory",
  };
  return `${pathname}?section=${params.get("section") || defaults[pathname] || ""}`;
}
