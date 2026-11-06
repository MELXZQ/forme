"use client";
import { Select } from "@/components/ui/Select";

import { useState } from "react";
import type { ProductInput, VariantInput } from "@/lib/validation";
import { api, type Taxonomy, type MediaItem } from "./api";
import { Asset } from "../Asset";
import s from "./Admin.module.css";
export type EditableProduct = ProductInput & { id?: string };
export const emptyVariant = (): VariantInput => ({
  sku: "",
  size: "",
  color: "",
  priceCents: 8900,
  compareAtPriceCents: null,
  currency: "AUD",
  stock: 0,
  enabled: true,
  sortOrder: 0,
});
export function ProductEditor({
  initial,
  categories,
  collections,
  media,
  onSaved,
  onClose,
  onMedia,
  operations = false,
}: {
  initial: EditableProduct;
  categories: Taxonomy[];
  collections: Taxonomy[];
  media: MediaItem[];
  onSaved: (id: string) => Promise<void>;
  onClose: () => void;
  onMedia: () => Promise<void>;
  operations?: boolean;
}) {
  const [draft, setDraft] = useState(initial),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const update = (value: Partial<EditableProduct>) =>
    setDraft((d) => ({ ...d, ...value }));
  const variant = (index: number, value: Partial<VariantInput>) =>
    setDraft((d) => ({
      ...d,
      variants: d.variants.map((v, i) =>
        i === index ? { ...v, ...value } : v,
      ),
    }));
  const moveImage = (index: number, direction: number) =>
    setDraft((d) => {
      const images = [...d.images];
      const target = index + direction;
      if (target < 0 || target >= images.length) return d;
      [images[index], images[target]] = [images[target], images[index]];
      return {
        ...d,
        images: images.map((image, sortOrder) => ({ ...image, sortOrder })),
      };
    });
  return (
    <form
      className={s.form}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        setNotice("");
        try {
          const value = await api<{ id: string }>(
            initial.id ? `products/${initial.id}` : "products",
            {
              method: initial.id ? "PUT" : "POST",
              body: JSON.stringify({
                ...draft,
                variants: draft.variants.map((v, sortOrder) => ({
                  ...v,
                  sortOrder,
                })),
                images: draft.images.map((image, sortOrder) => ({
                  ...image,
                  sortOrder,
                })),
              }),
            },
          );
          await onSaved(value.id);
          setNotice(
            "Saved. Published changes are available on the next storefront request.",
          );
        } catch (e) {
          setError(e instanceof Error ? e.message : "Save failed.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>{initial.id ? "Edit product" : "New product"}</h2>
      <p className={s.small}>
        One primary category, any number of collections. Amounts are integer AUD
        cents: 8900 = A$89.00. Saving does not process transactions.
      </p>
      <fieldset className={s.fieldset} disabled={busy || uploading}>
        <div className={s.grid}>
          <label className={s.field}>
            Name
            <input
              required
              maxLength={180}
              value={draft.name}
              onChange={(e) => update({ name: e.target.value })}
            />
          </label>
          <label className={s.field}>
            Slug
            <input
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              value={draft.slug}
              onChange={(e) => update({ slug: e.target.value })}
            />
          </label>
          <label className={`${s.field} ${s.full}`}>
            Short description
            <textarea
              maxLength={500}
              value={draft.summary}
              onChange={(e) => update({ summary: e.target.value })}
            />
          </label>
          <label className={`${s.field} ${s.full}`}>
            Detailed description
            <textarea
              value={draft.description}
              onChange={(e) => update({ description: e.target.value })}
            />
          </label>
          {operations && (
            <label className={`${s.field} ${s.full}`}>
              Change reason (especially for price / publication changes)
              <input
                minLength={3}
                maxLength={1000}
                value={draft.changeReason || ""}
                onChange={(e) =>
                  update({ changeReason: e.target.value || undefined })
                }
              />
            </label>
          )}
          <label className={s.field}>
            Category
            <Select
              aria-label="Category"
              required
              value={draft.categoryId}
              onChange={(e) => update({ categoryId: e.target.value })}
            >
              <option value="">Choose a category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {!c.active ? " (disabled)" : ""}
                </option>
              ))}
            </Select>
          </label>
          <label className={s.field}>
            Publication status
            <Select
              aria-label="Publication status"
              value={draft.status}
              onChange={(e) =>
                update({ status: e.target.value as ProductInput["status"] })
              }
            >
              <option value="DRAFT">Draft</option>
              <option value="PUBLISHED">Published</option>
              <option value="ARCHIVED">Archived</option>
            </Select>
          </label>
          <label className={s.check}>
            <input
              type="checkbox"
              checked={draft.isFeatured}
              onChange={(e) => update({ isFeatured: e.target.checked })}
            />
            Feature in New arrivals (independent of newest sorting)
          </label>
          <label className={s.field}>
            Homepage product order
            <input
              type="number"
              min={0}
              step={1}
              value={draft.featuredOrder}
              onChange={(e) =>
                update({ featuredOrder: Number(e.target.value) })
              }
            />
          </label>
        </div>
        <h3>Collections</h3>
        <div className={s.actions}>
          {collections.map((c) => (
            <label className={s.check} key={c.id}>
              <input
                type="checkbox"
                checked={draft.collectionIds.includes(c.id)}
                onChange={(e) =>
                  update({
                    collectionIds: e.target.checked
                      ? [...draft.collectionIds, c.id]
                      : draft.collectionIds.filter((id) => id !== c.id),
                  })
                }
              />
              {c.name}
            </label>
          ))}
        </div>
        <h3>SKUs / sizes / stock</h3>
        {draft.variants.map((v, i) => (
          <div className={s.variant} key={v.id || `new-${i}`}>
            {(["sku", "size", "color"] as const).map((key) => (
              <label key={key} className={s.field}>
                {key === "sku" ? "Unique SKU" : key}
                <input
                  value={v[key]}
                  required={key === "sku"}
                  onChange={(e) => variant(i, { [key]: e.target.value })}
                />
              </label>
            ))}
            <label className={s.field}>
              Price (AUD cents)
              <input
                type="number"
                required
                min={1}
                step={1}
                value={v.priceCents}
                onChange={(e) =>
                  variant(i, { priceCents: Number(e.target.value) })
                }
              />
            </label>
            <label className={s.field}>
              Compare-at (cents, optional)
              <input
                type="number"
                min={1}
                step={1}
                value={v.compareAtPriceCents ?? ""}
                onChange={(e) =>
                  variant(i, {
                    compareAtPriceCents:
                      e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
            </label>
            <label className={s.field}>
              {operations ? "Original legacy quantity (read-only)" : "Stock"}
              <input
                type="number"
                required
                min={0}
                step={1}
                value={v.stock}
                readOnly={operations}
                onChange={(e) => variant(i, { stock: Number(e.target.value) })}
              />
            </label>
            <label className={s.check}>
              <input
                type="checkbox"
                checked={v.enabled}
                onChange={(e) => variant(i, { enabled: e.target.checked })}
              />
              Enabled
            </label>
            <button
              type="button"
              className={s.secondary}
              disabled={draft.variants.length === 1}
              onClick={() =>
                update({
                  variants: draft.variants.filter((_, index) => index !== i),
                  images: draft.images.map((image) =>
                    image.variantId === v.id
                      ? { ...image, variantId: null }
                      : image,
                  ),
                })
              }
            >
              Remove from editor
            </button>
          </div>
        ))}
        <button
          className={s.secondary}
          type="button"
          onClick={() =>
            update({ variants: [...draft.variants, emptyVariant()] })
          }
        >
          Add SKU
        </button>
        <p className={s.small}>
          {operations &&
            "Warehouse quantities are managed through Inventory → Stock. The original legacy value is not sellable stock. "}
          No options? Keep one default SKU. Removed saved SKUs are disabled,
          preserving their stable IDs. Save new SKUs before attaching
          SKU-specific images.
        </p>
        <h3>Images / order / alternative text</h3>
        <label className={s.field}>
          Upload JPEG, PNG or WebP (up to 5 files, 8 MB each)
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={async (e) => {
              const target = e.currentTarget;
              const files = Array.from(target.files || []);
              if (!files.length) return;
              setUploading(true);
              setError("");
              try {
                const form = new FormData();
                files.forEach((file) => form.append("files", file));
                const uploaded = await api<MediaItem[]>("media", {
                  method: "POST",
                  body: form,
                });
                await onMedia();
                setDraft((d) => ({
                  ...d,
                  images: [
                    ...d.images,
                    ...uploaded.map((m, i) => ({
                      mediaId: m.id,
                      alt: m.alt,
                      sortOrder: d.images.length + i,
                      variantId: null,
                    })),
                  ],
                }));
                setNotice("Images uploaded. Save this product to attach them.");
              } catch (e) {
                setError(e instanceof Error ? e.message : "Upload failed.");
              } finally {
                setUploading(false);
                target.value = "";
              }
            }}
          />
        </label>
        <label className={s.field} style={{ marginTop: 15 }}>
          Attach an existing image
          <Select
            aria-label="Attach an existing image"
            value=""
            onChange={(e) => {
              const m = media.find((m) => m.id === e.target.value);
              if (m && !draft.images.some((i) => i.mediaId === m.id))
                update({
                  images: [
                    ...draft.images,
                    {
                      mediaId: m.id,
                      alt: m.alt,
                      variantId: null,
                      sortOrder: draft.images.length,
                    },
                  ],
                });
            }}
          >
            <option value="">Choose media…</option>
            {media.map((m) => (
              <option key={m.id} value={m.id}>
                {m.alt || m.id}
              </option>
            ))}
          </Select>
        </label>
        {draft.images.map((image, i) => {
          const m = media.find((m) => m.id === image.mediaId);
          return (
            <div className={s.imageRow} key={image.mediaId}>
              <Asset
                src={m?.src || `/media/${image.mediaId}`}
                alt={m?.alt || "Product image"}
                width={70}
                height={70}
              />
              <label className={s.field}>
                Alternative text
                <input
                  maxLength={500}
                  value={image.alt ?? m?.alt ?? ""}
                  onChange={(e) =>
                    update({
                      images: draft.images.map((item, index) =>
                        index === i ? { ...item, alt: e.target.value } : item,
                      ),
                    })
                  }
                />
              </label>
              <label className={s.field}>
                SKU association
                <Select
                  aria-label="SKU association"
                  value={image.variantId || ""}
                  onChange={(e) =>
                    update({
                      images: draft.images.map((item, index) =>
                        index === i
                          ? { ...item, variantId: e.target.value || null }
                          : item,
                      ),
                    })
                  }
                >
                  <option value="">All SKUs</option>
                  {draft.variants
                    .filter((v) => v.id)
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.sku}
                      </option>
                    ))}
                </Select>
              </label>
              <div>
                <button
                  type="button"
                  aria-label={`Move image ${i + 1} up`}
                  disabled={i === 0}
                  onClick={() => moveImage(i, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move image ${i + 1} down`}
                  disabled={i === draft.images.length - 1}
                  onClick={() => moveImage(i, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() =>
                    update({
                      images: draft.images.filter((_, index) => index !== i),
                    })
                  }
                >
                  Detach
                </button>
              </div>
            </div>
          );
        })}
        <div className={s.actions}>
          <button className={s.button} disabled={busy || uploading}>
            {busy ? "Saving…" : uploading ? "Uploading…" : "Save product"}
          </button>
          <button type="button" className={s.secondary} onClick={onClose}>
            Close editor
          </button>
          {initial.slug && (
            <a
              className={s.secondary}
              href={`/products/${initial.slug}`}
              target="_blank"
              rel="noreferrer"
            >
              View storefront
            </a>
          )}
        </div>
      </fieldset>
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
    </form>
  );
}
