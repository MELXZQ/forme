"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import type { ModelScene } from "@/lib/types";

import { Icon } from "./Icon";
import { Asset } from "./Asset";
import s from "./Site.module.css";
const clamp = (n: number) => Math.min(1, Math.max(0, n));
export function ModelExplorer({ modelScene }: { modelScene: ModelScene }) {
  const section = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = section.current;
    const view = stage.current;
    if (!el || !view) return;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    const render = () => {
      frame = 0;
      const rect = el.getBoundingClientRect();
      const top = parseFloat(getComputedStyle(view).top) || 0;
      const travel = el.offsetHeight - view.offsetHeight;
      const progress = media.matches
        ? 1
        : clamp((top - rect.top) / Math.max(1, travel));
      el.style.setProperty("--dark", String(clamp(progress / 0.42)));
      el.style.setProperty("--rise", `${(1 - clamp(progress / 0.5)) * 65}%`);
      el.style.setProperty(
        "--figure-opacity",
        String(0.2 + 0.8 * clamp(progress / 0.35)),
      );
      modelScene.markers.forEach((m) => {
        const visible = media.matches
          ? 1
          : clamp((progress - 0.48 - m.order * 0.035) / 0.14);
        el.style.setProperty(`--label-${m.order}`, String(visible));
        el.style.setProperty(
          `--hit-${m.order}`,
          visible > 0.95 ? "auto" : "none",
        );
      });
    };
    const update = () => {
      if (!frame) frame = requestAnimationFrame(render);
    };
    render();
    addEventListener("scroll", update, { passive: true });
    addEventListener("resize", update);
    media.addEventListener("change", update);
    const observer = new ResizeObserver(update);
    observer.observe(el);
    observer.observe(view);
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener("scroll", update);
      removeEventListener("resize", update);
      media.removeEventListener("change", update);
      observer.disconnect();
    };
  }, [modelScene]);
  return (
    <section
      ref={section}
      className={s.modelSection}
      aria-labelledby="model-title"
    >
      <div ref={stage} className={s.modelStage}>
        <div className={s.modelBackdrop} />
        <div className={s.modelHeading}>
          <p className={s.eyebrow}>THE DETAILS MAKE THE DIFFERENCE</p>
          <h2 id="model-title">Wear it your way.</h2>
          <p>Find your next signature.</p>
        </div>
        <div className={s.modelCanvas}>
          <Asset
            mobileSrc={modelScene.mobile.image}
            pictureClassName={s.modelFigure}
            src={modelScene.desktop.image}
            alt={modelScene.desktop.alt}
            width={1000}
            height={760}
            style={
              {
                objectPosition: modelScene.desktop.objectPosition,
                "--model-mobile-position": modelScene.mobile.objectPosition,
              } as React.CSSProperties
            }
          />
          <svg
            className={`${s.markerLines} ${s.desktopLines}`}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {modelScene.markers.map((m) => (
              <g key={m.id} style={{ opacity: `var(--label-${m.order}, 0)` }}>
                <path
                  d={`M${m.desktop.anchor.join(" ")} L${m.desktop.label[0] + 7} ${m.desktop.label[1] + 3}`}
                />
                <circle
                  cx={m.desktop.anchor[0]}
                  cy={m.desktop.anchor[1]}
                  r=".4"
                />
              </g>
            ))}
          </svg>
          <svg
            className={`${s.markerLines} ${s.mobileLines}`}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {modelScene.markers.map((m) => (
              <g key={m.id} style={{ opacity: `var(--label-${m.order}, 0)` }}>
                <path
                  d={`M${m.mobile.anchor.join(" ")} L${m.mobile.label[0] + 10} ${m.mobile.label[1] + 4}`}
                />
                <circle
                  cx={m.mobile.anchor[0]}
                  cy={m.mobile.anchor[1]}
                  r=".65"
                />
              </g>
            ))}
          </svg>
          {modelScene.markers.map((m) => (
            <Link
              key={m.id}
              href={`/shop?category=${m.id}`}
              className={s.modelMarker}
              style={
                {
                  "--dx": `${m.desktop.label[0]}%`,
                  "--dy": `${m.desktop.label[1]}%`,
                  "--mx": `${m.mobile.label[0]}%`,
                  "--my": `${m.mobile.label[1]}%`,
                  "--label-opacity": `var(--label-${m.order}, 0)`,
                  "--label-hit": `var(--hit-${m.order}, none)`,
                } as React.CSSProperties
              }
              onFocus={() => {
                section.current?.style.setProperty(`--label-${m.order}`, "1");
              }}
            >
              <span>{m.name || m.id}</span>
              <small>
                View products <Icon name="arrow" size={13} />
              </small>
            </Link>
          ))}
        </div>
        <p className={s.modelScroll}>
          SCROLL TO EXPLORE <span aria-hidden="true">↓</span>
        </p>
      </div>
    </section>
  );
}
