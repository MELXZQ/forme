"use client";
import { useEffect, useRef } from "react";
import Form from "next/form";
import { useSearchParams } from "next/navigation";
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
  const params = useSearchParams();
  const queryKey = params.toString();
  useEffect(() => {
    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
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
      });
    };
    sync();
    addEventListener("pageshow", sync);
    addEventListener("popstate", sync);
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener("pageshow", sync);
      removeEventListener("popstate", sync);
    };
  }, [queryKey]);
  return (
    <Form ref={form} action="/shop" className={className}>
      {children}
    </Form>
  );
}
