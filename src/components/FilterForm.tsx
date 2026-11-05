"use client";
import { useEffect, useRef } from "react";
import Form from "next/form";
import { useRouter, useSearchParams } from "next/navigation";
// Browsers may restore unsent form edits from the back/forward cache.
// Reapply server-rendered defaults so visible controls always reflect the URL.
export function FilterForm({
  children,
  className,
}: {
  children: React.ReactNode;
  className: string;
}) {
  const form = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const params = useSearchParams();
  const queryKey = params.toString();
  // Controls from the server can arrive after the URL context changes.
  // Sync on either update, including cached history entries.
  useEffect(() => {
    let frame = 0;
    const applyValues = () => {
      const values = new URLSearchParams(window.location.search);
      form.current
        ?.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
          "input, select",
        )
        .forEach((field) => {
          if (field instanceof HTMLInputElement && field.type === "checkbox")
            field.checked = values.get(field.name) === field.value;
          else
            field.value =
              values.get(field.name) ||
              (field.name === "sort" ? "featured" : "");
        });
    };
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(applyValues);
    };
    applyValues();
    addEventListener("pageshow", sync);
    addEventListener("popstate", sync);
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener("pageshow", sync);
      removeEventListener("popstate", sync);
    };
  }, [queryKey, children]);
  return (
    <Form
      ref={form}
      action="/shop"
      className={className}
      scroll={false}
      onChange={(event) => {
        const field = event.target;
        if (
          field instanceof HTMLSelectElement ||
          (field instanceof HTMLInputElement && field.type === "checkbox")
        ) {
          const values = new URLSearchParams();
          new FormData(event.currentTarget).forEach((value, name) => {
            if (typeof value === "string") values.set(name, value);
          });
          router.push(`/shop?${values.toString()}`, { scroll: false });
        }
      }}
    >
      {children}
    </Form>
  );
}
