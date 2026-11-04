"use client";
import { useStore } from "./StoreProvider";
import { Icon } from "./Icon";
import s from "./Site.module.css";
export function AddToBag({ id }: { id: string }) {
  const { add, ready } = useStore();
  return (
    <button disabled={!ready} className={s.darkButton} onClick={() => add(id)}>
      Add to demo bag <Icon name="plus" size={17} />
    </button>
  );
}
