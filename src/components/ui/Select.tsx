"use client";

import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { Select as Menu } from "@base-ui/react/select";
import s from "./Select.module.css";

type Props = SelectHTMLAttributes<HTMLSelectElement>;
type Option = { value: string; label: string; disabled: boolean };
function changeNativeSelection(el: HTMLSelectElement, values: string[]) {
  for (const option of el.options)
    option.selected = values.includes(option.value);
  el.dispatchEvent(new Event("change", { bubbles: true }));
}
function text(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child)
        ? text(child.props.children)
        : String(child),
    )
    .join("");
}
function optionsFrom(children: ReactNode): Option[] {
  return Children.toArray(children).flatMap((child) => {
    if (
      !isValidElement<{
        value?: string | number;
        children?: ReactNode;
        disabled?: boolean;
      }>(child)
    )
      return [];
    if (child.type !== "option") return optionsFrom(child.props.children);
    const label = text(child.props.children);
    return [
      {
        value: String(child.props.value ?? label),
        label,
        disabled: !!child.props.disabled,
      },
    ];
  });
}

/** Custom, keyboard-accessible menu with the existing HTML form contract.
 * The hidden select owns validation/FormData and emits a real change event so
 * immediate Shop filters and controlled single/multiple forms behave alike.
 */
export function Select({
  children,
  value,
  defaultValue,
  multiple = false,
  onChange,
  id,
  className,
  style,
  disabled,
  required,
  ...props
}: Props) {
  const generatedId = useId();
  const controlId = id || generatedId;
  const native = useRef<HTMLSelectElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = optionsFrom(children);
  const initial =
    defaultValue ??
    (multiple ? [] : (items.find((o) => !o.disabled)?.value ?? ""));
  const [internal, setInternal] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  const current = value ?? internal;
  const selected = multiple
    ? Array.isArray(current)
      ? current.map(String)
      : []
    : String(current);
  const labels = items
    .filter((o) =>
      Array.isArray(selected)
        ? selected.includes(o.value)
        : selected === o.value,
    )
    .map((o) => o.label);
  const display = multiple
    ? labels.length > 1
      ? `${labels[0]} +${labels.length - 1}`
      : labels[0] || "Choose…"
    : labels[0] || "Choose…";

  useEffect(() => {
    const el = native.current;
    if (!el) return;
    const sync = () => {
      setInternal(
        el.multiple ? Array.from(el.selectedOptions, (o) => o.value) : el.value,
      );
      setInvalid(false);
    };
    const reset = () => queueMicrotask(sync);
    el.addEventListener("forme:select-sync", sync);
    el.form?.addEventListener("reset", reset);
    return () => {
      el.removeEventListener("forme:select-sync", sync);
      el.form?.removeEventListener("reset", reset);
    };
  }, []);

  return (
    <span
      className={[s.root, className].filter(Boolean).join(" ")}
      style={style}
      data-select-container
    >
      <Menu.Root
        items={items}
        value={selected}
        multiple={multiple}
        disabled={disabled}
        modal={false}
        onValueChange={(next) => {
          const el = native.current;
          if (!el || el.matches(":disabled")) return;
          const values = Array.isArray(next) ? next : [next ?? ""];
          changeNativeSelection(el, values);
        }}
      >
        <Menu.Trigger
          ref={trigger}
          id={controlId}
          className={s.trigger}
          aria-label={props["aria-label"]}
          aria-labelledby={props["aria-labelledby"]}
          aria-required={required || undefined}
          aria-invalid={invalid || props["aria-invalid"] || undefined}
          aria-describedby={
            [props["aria-describedby"], invalid ? `${controlId}-error` : ""]
              .filter(Boolean)
              .join(" ") || undefined
          }
          title={labels.join(", ") || props.title}
        >
          <Menu.Value className={s.value}>{display}</Menu.Value>
          <Menu.Icon className={s.icon}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="m4 6 4 4 4-4"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Menu.Icon>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner
            sideOffset={6}
            alignItemWithTrigger={false}
            collisionPadding={12}
            className={s.positioner}
          >
            <Menu.Popup className={s.popup}>
              {multiple && (
                <div className={s.hint}>Select one or more · Esc to close</div>
              )}
              <Menu.List className={s.list}>
                {items.map((item) => (
                  <Menu.Item
                    key={item.value}
                    value={item.value}
                    disabled={item.disabled}
                    className={s.option}
                  >
                    <Menu.ItemText>{item.label}</Menu.ItemText>
                    <Menu.ItemIndicator className={s.check}>
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 16 16"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d="m3 8 3 3 7-7"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </Menu.ItemIndicator>
                  </Menu.Item>
                ))}
                {!items.length && (
                  <div className={s.hint}>No options available</div>
                )}
              </Menu.List>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      <select
        {...props}
        id={`${controlId}-native`}
        ref={native}
        className={s.native}
        aria-hidden="true"
        aria-label={undefined}
        aria-labelledby={undefined}
        tabIndex={-1}
        multiple={multiple}
        disabled={disabled}
        required={required}
        value={selected}
        onInvalid={(event) => {
          event.preventDefault();
          setInvalid(true);
          trigger.current?.focus();
          props.onInvalid?.(event);
        }}
        onChange={(event) => {
          if (value === undefined)
            setInternal(
              multiple
                ? Array.from(event.target.selectedOptions, (o) => o.value)
                : event.target.value,
            );
          setInvalid(false);
          onChange?.(event);
        }}
      >
        {!multiple && selected === "" && !items.some((o) => o.value === "") && (
          <option value="">Choose…</option>
        )}
        {children}
      </select>
      {invalid && (
        <span className={s.error} id={`${controlId}-error`} role="alert">
          Choose an option.
        </span>
      )}
    </span>
  );
}
