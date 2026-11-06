"use client";
import { Select } from "@/components/ui/Select";

import { useState, useEffect, useCallback, useRef } from "react";
import { api, type Taxonomy, type MediaItem } from "./api";
import { EntityForm, type Field } from "./EntityForm";
import {
  ProductEditor,
  emptyVariant,
  type EditableProduct,
} from "./ProductEditor";
import { Asset } from "../Asset";
import { ProductChecks } from "../notifications/StockTools";
import s from "./Admin.module.css";
export type CatalogueSection =
  "products" | "categories" | "collections" | "media" | "home";
type Row = {
  id: string;
  name?: string;
  slug?: string;
  status?: string;
  category?: { name: string };
  active?: boolean;
  title?: string;
  [key: string]: unknown;
};
type Home = { settings: Row | null; slides: Row[]; markers: Row[] };
export function AdminApp({
  section,
  operations = true,
}: {
  section: CatalogueSection;
  operations?: boolean;
}) {
  const loadVersion = useRef(0);
  const [rows, setRows] = useState<Row[]>([]),
    [categories, setCategories] = useState<Taxonomy[]>([]),
    [collections, setCollections] = useState<Taxonomy[]>([]),
    [media, setMedia] = useState<MediaItem[]>([]),
    [home, setHome] = useState<Home>({
      settings: null,
      slides: [],
      markers: [],
    });
  const [editorVersion, setEditorVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState<EditableProduct | null>(null),
    [entity, setEntity] = useState<Row | null>(null),
    [homeKind, setHomeKind] = useState<"slide" | "marker">("slide"),
    [q, setQ] = useState(""),
    [status, setStatus] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const loadMedia = useCallback(
    async () => setMedia(await api<MediaItem[]>("media")),
    [],
  );
  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    try {
      const [cats, cols, images, resource] = await Promise.all([
        api<Taxonomy[]>("categories"),
        api<Taxonomy[]>("collections"),
        api<MediaItem[]>("media"),
        section === "products"
          ? api<Row[]>(`products?q=${encodeURIComponent(q)}&status=${status}`)
          : section === "home"
            ? api<Home>("home")
            : Promise.resolve(null),
      ]);
      if (version !== loadVersion.current) return;
      setCategories(cats);
      setCollections(cols);
      setMedia(images);
      if (section === "products") setRows(resource as Row[]);
      else if (section === "home") setHome(resource as Home);
      else if (section === "categories") setRows(cats);
      else if (section === "collections") setRows(cols);
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [section, q, status]);
  const invalidateLoads = useCallback(() => {
    loadVersion.current++;
  }, []);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled)
        load().catch((e) => {
          if (!cancelled)
            setError(e instanceof Error ? e.message : "Load failed.");
        });
    });
    return () => {
      cancelled = true;
      invalidateLoads();
    };
  }, [load, invalidateLoads]);
  const mediaOptions = [
    { value: "", label: "No image" },
    ...media.map((m) => ({ value: m.id, label: m.alt || m.id })),
  ];
  const categoryOptions = [
    { value: "", label: "Choose category" },
    ...categories.map((c) => ({ value: c.id, label: c.name })),
  ];
  const taxFields: Field[] = [
    { name: "name", label: "Name", required: true },
    { name: "slug", label: "Slug", required: true },
    { name: "description", label: "Description", type: "textarea" },
    { name: "sortOrder", label: "Display order", type: "number" },
    { name: "active", label: "Enabled", type: "checkbox" },
    ...(section === "collections"
      ? [
          {
            name: "featured",
            label: "Show on homepage",
            type: "checkbox" as const,
          },
          {
            name: "mediaId",
            label: "Collection image",
            type: "select" as const,
            options: mediaOptions,
            nullable: true,
          },
        ]
      : []),
  ];
  const slideFields: Field[] = [
    { name: "eyebrow", label: "Eyebrow" },
    {
      name: "title",
      label: "Title (line breaks supported)",
      type: "textarea",
      required: true,
    },
    { name: "description", label: "Description", type: "textarea" },
    { name: "cta", label: "CTA label", required: true },
    { name: "href", label: "CTA local URL", required: true },
    {
      name: "desktopMediaId",
      label: "Desktop image",
      type: "select",
      options: mediaOptions,
      required: true,
    },
    {
      name: "mobileMediaId",
      label: "Mobile image (optional)",
      type: "select",
      options: mediaOptions,
      nullable: true,
    },
    { name: "position", label: "Desktop crop (50% 50%)" },
    { name: "mobilePosition", label: "Mobile crop (50% 50%)" },
    { name: "sortOrder", label: "Display order", type: "number" },
    { name: "active", label: "Enabled", type: "checkbox" },
  ];
  const markerFields: Field[] = [
    {
      name: "categoryId",
      label: "Target category",
      type: "select",
      options: categoryOptions,
      required: true,
    },
    { name: "sortOrder", label: "Appearance order", type: "number" },
    { name: "active", label: "Enabled", type: "checkbox" },
    ...[
      "desktopAnchorX",
      "desktopAnchorY",
      "desktopLabelX",
      "desktopLabelY",
      "mobileAnchorX",
      "mobileAnchorY",
      "mobileLabelX",
      "mobileLabelY",
    ].map((name) => ({
      name,
      label: `${name} (0–100%)`,
      type: "number" as const,
      step: "0.1",
    })),
  ];
  return (
    <div className={s.root} data-admin>
      <div className={s.content}>
        {loading && (
          <p role="status" className={s.small}>
            Loading content…
          </p>
        )}
        <div className={s.heading}>
          <h1>
            {section === "home"
              ? "Homepage content"
              : section[0].toUpperCase() + section.slice(1)}
          </h1>
          {section === "products" && (
            <button
              className={s.button}
              disabled={loading}
              onClick={() =>
                setEditing({
                  slug: "",
                  name: "",
                  summary: "",
                  description: "",
                  status: "DRAFT",
                  categoryId: categories[0]?.id || "",
                  isFeatured: false,
                  featuredOrder: 0,
                  collectionIds: [],
                  variants: [emptyVariant()],
                  images: [],
                })
              }
            >
              New product
            </button>
          )}
          {(section === "categories" || section === "collections") && (
            <button
              className={s.button}
              onClick={() =>
                setEntity({
                  id: "",
                  slug: "",
                  name: "",
                  description: "",
                  sortOrder: rows.length,
                  active: true,
                  featured: true,
                  mediaId: null,
                })
              }
            >
              New {section === "categories" ? "category" : "collection"}
            </button>
          )}
        </div>
        {error && (
          <p role="alert" className={`${s.notice} ${s.error}`}>
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className={s.notice}>
            {notice}
          </p>
        )}
        {section === "products" && (
          <>
            {!editing && (
              <details className={s.notice}>
                <summary>Product information reminder settings</summary>
                <ProductChecks />
              </details>
            )}
            <div className={s.toolbar}>
              <input
                aria-label="Search admin products"
                placeholder="Search products…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <Select
                aria-label="Filter product status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">All states</option>
                {["DRAFT", "PUBLISHED", "ARCHIVED"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </Select>
            </div>
            {editing && (
              <ProductEditor
                key={`${editing.id || "new"}-${editorVersion}`}
                initial={editing}
                operations={operations}
                categories={categories}
                collections={collections}
                media={media}
                onMedia={loadMedia}
                onClose={() => setEditing(null)}
                onSaved={async (id) => {
                  await load();
                  setEditing(await api<EditableProduct>(`products/${id}`));
                  setEditorVersion((v) => v + 1);
                  setNotice("Product saved.");
                }}
              />
            )}
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Status</th>
                    <th>Category</th>
                    <th>Manage</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        {row.name}
                        <br />
                        <small>{row.slug}</small>
                      </td>
                      <td>
                        <span className={s.tag}>{row.status}</span>
                      </td>
                      <td>{row.category?.name}</td>
                      <td>
                        <button
                          onClick={async () => {
                            try {
                              setEditing(
                                await api<EditableProduct>(
                                  `products/${row.id}`,
                                ),
                              );
                            } catch (e) {
                              setError((e as Error).message);
                            }
                          }}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!loading && !rows.length && (
                <p className={s.small}>No products match these filters.</p>
              )}
            </div>
          </>
        )}
        {(section === "categories" || section === "collections") && (
          <>
            {entity && (
              <EntityForm
                key={`${section}-${entity.id}`}
                title={entity.id ? "Edit item" : "New item"}
                initial={entity}
                fields={taxFields}
                onCancel={() => setEntity(null)}
                onSave={async (data) => {
                  await api(entity.id ? `${section}/${entity.id}` : section, {
                    method: entity.id ? "PUT" : "POST",
                    body: JSON.stringify(data),
                  });
                  await load();
                  setEntity(null);
                  setNotice(
                    "Saved. Disable an item to hide it; referenced records are preserved.",
                  );
                }}
              />
            )}
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Slug</th>
                    <th>Enabled</th>
                    <th>Manage</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.name}</td>
                      <td>{row.slug}</td>
                      <td>{row.active ? "Yes" : "No"}</td>
                      <td>
                        <button onClick={() => setEntity(row)}>Edit</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {section === "media" && (
          <>
            <p className={s.small}>
              Uploads are validated and re-encoded to WebP. Referenced images
              cannot be deleted. Detach images from products, collections,
              slides and the model configuration first.
            </p>
            <label className={s.field}>
              Upload images
              <input
                type="file"
                multiple
                disabled={uploading}
                accept="image/jpeg,image/png,image/webp"
                onChange={async (e) => {
                  const target = e.currentTarget,
                    files = Array.from(target.files || []);
                  if (!files.length) return;
                  setUploading(true);
                  setError("");
                  setNotice("Uploading images…");
                  try {
                    const form = new FormData();
                    files.forEach((f) => form.append("files", f));
                    await api("media", { method: "POST", body: form });
                    await loadMedia();
                    setNotice("Upload complete.");
                  } catch (e) {
                    setNotice("");
                    setError((e as Error).message);
                  } finally {
                    setUploading(false);
                    target.value = "";
                  }
                }}
              />
            </label>
            <div className={s.mediaGrid}>
              {media.map((m) => (
                <MediaCard
                  key={m.id}
                  media={m}
                  refresh={loadMedia}
                  onError={setError}
                  onNotice={setNotice}
                />
              ))}
            </div>
          </>
        )}
        {section === "home" && (
          <>
            <p className={s.small}>
              New arrivals are selected and ordered in each product editor.
              Homepage collections are selected and ordered in Collections.
              Coordinates below are percentages relative to the model canvas;
              desktop and mobile are independent.
            </p>
            <EntityForm
              key={String(home.settings?.updatedAt || "settings")}
              title="Model images"
              initial={
                home.settings || {
                  desktopMediaId: null,
                  mobileMediaId: null,
                  desktopPosition: "50% 50%",
                  mobilePosition: "50% 50%",
                }
              }
              fields={[
                {
                  name: "desktopMediaId",
                  label: "Desktop model",
                  type: "select",
                  nullable: true,
                  options: mediaOptions,
                },
                {
                  name: "mobileMediaId",
                  label: "Mobile model",
                  type: "select",
                  nullable: true,
                  options: mediaOptions,
                },
                { name: "desktopPosition", label: "Desktop crop" },
                { name: "mobilePosition", label: "Mobile crop" },
              ]}
              onSave={async (data) => {
                await api("home", {
                  method: "PUT",
                  body: JSON.stringify({ kind: "settings", data }),
                });
                await load();
                setNotice("Model images and crop settings saved.");
              }}
            />
            <div className={s.heading}>
              <h2>Carousel slides</h2>
              <button
                className={s.secondary}
                onClick={() => {
                  setHomeKind("slide");
                  setEntity({
                    id: "",
                    eyebrow: "",
                    title: "",
                    description: "",
                    cta: "Explore",
                    href: "/shop",
                    desktopMediaId: "",
                    mobileMediaId: null,
                    position: "50% 50%",
                    mobilePosition: "50% 50%",
                    sortOrder: home.slides.length,
                    active: true,
                  });
                }}
              >
                Add slide
              </button>
            </div>
            {home.slides.map((row) => (
              <div className={s.toolbar} key={row.id}>
                <span>
                  {String(row.title)} · order {String(row.sortOrder)} ·{" "}
                  {row.active ? "enabled" : "disabled"}
                </span>
                <button
                  className={s.secondary}
                  onClick={() => {
                    setHomeKind("slide");
                    setEntity(row);
                  }}
                >
                  Edit slide
                </button>
              </div>
            ))}
            <div className={s.heading}>
              <h2>Model category markers</h2>
              <button
                className={s.secondary}
                onClick={() => {
                  setHomeKind("marker");
                  setEntity({
                    id: "",
                    categoryId: "",
                    sortOrder: home.markers.length,
                    active: true,
                    desktopAnchorX: 50,
                    desktopAnchorY: 50,
                    desktopLabelX: 10,
                    desktopLabelY: 50,
                    mobileAnchorX: 50,
                    mobileAnchorY: 50,
                    mobileLabelX: 5,
                    mobileLabelY: 50,
                  });
                }}
              >
                Add marker
              </button>
            </div>
            {home.markers.map((row) => (
              <div className={s.toolbar} key={row.id}>
                <span>
                  {categories.find((c) => c.id === row.categoryId)?.name ||
                    String(row.categoryId)}{" "}
                  · order {String(row.sortOrder)}
                </span>
                <button
                  className={s.secondary}
                  onClick={() => {
                    setHomeKind("marker");
                    setEntity(row);
                  }}
                >
                  Edit marker
                </button>
              </div>
            ))}
            {entity && (
              <EntityForm
                key={`${homeKind}-${entity.id}`}
                title={
                  homeKind === "slide"
                    ? "Edit carousel slide"
                    : "Edit model marker"
                }
                initial={entity}
                fields={homeKind === "slide" ? slideFields : markerFields}
                onCancel={() => setEntity(null)}
                onSave={async (data) => {
                  await api("home", {
                    method: "PUT",
                    body: JSON.stringify({
                      kind: homeKind,
                      id: entity.id || undefined,
                      data,
                    }),
                  });
                  await load();
                  setEntity(null);
                  setNotice("Homepage content saved.");
                }}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
function MediaCard({
  media,
  refresh,
  onError,
  onNotice,
}: {
  media: MediaItem;
  refresh: () => Promise<void>;
  onError: (e: string) => void;
  onNotice: (e: string) => void;
}) {
  const [alt, setAlt] = useState(media.alt),
    [busy, setBusy] = useState(false);
  return (
    <article className={s.mediaCard}>
      <Asset
        src={media.src}
        alt={media.alt || "Media preview"}
        width={200}
        height={150}
      />
      <p className={s.small}>
        {media.width}×{media.height} · {Math.ceil(media.sizeBytes / 1024)} KB
      </p>
      <label className={s.field}>
        Alternative text
        <input
          value={alt}
          onChange={(e) => setAlt(e.target.value)}
          maxLength={500}
        />
      </label>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api(`media/${media.id}`, {
              method: "PUT",
              body: JSON.stringify({ alt }),
            });
            await refresh();
            onNotice("Alternative text saved.");
          } catch (e) {
            onError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Save alt
      </button>
      <button
        disabled={busy}
        onClick={async () => {
          if (
            !window.confirm(
              "Delete this unreferenced media item? This removes its local file.",
            )
          )
            return;
          setBusy(true);
          try {
            await api(`media/${media.id}`, { method: "DELETE" });
            await refresh();
            onNotice("Unused media deleted.");
          } catch (e) {
            onError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Delete unused image
      </button>
    </article>
  );
}
