"use client";
import { Select } from "@/components/ui/Select";

import { useState } from "react";
import type { Product } from "@/lib/types";
import { useStore } from "./StoreProvider";
import { money, discount } from "@/lib/format";
import { Icon } from "./Icon";
import { availabilityLabel, etaLabel } from "@/lib/availability";
import s from "./Site.module.css";
export function ProductPurchase({ product: p }: { product: Product }) {
  const [id, setId] = useState(
    p.variants.find((v) => v.stock > 0)?.id || p.variants[0]?.id || "",
  );
  const { add, ready } = useStore();
  const v = p.variants.find((v) => v.id === id) || p.variants[0];
  if (!v) return <p>No available options.</p>;
  return (
    <>
      <p className={s.detailPrice}>
        {money(v.priceCents)} <span>AUD</span>
        {v.compareAtPriceCents && <del>{money(v.compareAtPriceCents)}</del>}
        {discount(v) > 0 && <small>Save {discount(v)}%</small>}
      </p>
      {p.variants.length > 1 && (
        <label style={{ display: "grid", gap: 8, marginBottom: 16 }}>
          Choose an option
          <Select
            aria-label="Product option"
            value={v.id}
            onChange={(e) => setId(e.target.value)}
          >
            {p.variants.map((v) => (
              <option key={v.id} value={v.id}>
                {[v.size, v.color].filter(Boolean).join(" / ") || "Default"} —{" "}
                {money(v.priceCents)}
                {v.stock === 0 ? " — out of stock" : ""}
              </option>
            ))}
          </Select>
        </label>
      )}
      <p className={s.muted}>
        {v.availability
          ? availabilityLabel(v.availability.status)
          : v.stock > 0
            ? "In stock"
            : "Out of stock"}{" "}
        · SKU {v.sku}
      </p>
      {v.availability?.etaStart && v.availability.etaEnd && (
        <p className={s.muted}>
          {etaLabel(v.availability.etaStart, v.availability.etaEnd)}
        </p>
      )}
      {v.availability && v.stock > 0 && (
        <p className={s.muted}>{v.stock} available in Melbourne.</p>
      )}
      <button
        disabled={!ready || v.stock < 1}
        className={s.darkButton}
        onClick={() => add(v.id, v.stock)}
      >
        {v.stock
          ? v.availability
            ? "Add to bag"
            : "Add to demo bag"
          : v.availability
            ? availabilityLabel(v.availability.status)
            : "Out of stock"}
        <Icon name="plus" size={17} />
      </button>
    </>
  );
}
