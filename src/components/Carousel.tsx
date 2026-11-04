"use client";
import Link from "next/link";
import { useEffect, useState, useRef } from "react";
import { slides } from "@/data/slides";
import { Asset } from "./Asset";
import { Icon } from "./Icon";
import s from "./Site.module.css";
export function Carousel() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  const [reduced, setReduced] = useState(true);
  const [hidden, setHidden] = useState(false);
  const touch = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    const visibility = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      media.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  const running = !paused && !hover && !focused && !reduced && !hidden;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(
      () => setIndex((i) => (i + 1) % slides.length),
      5500,
    );
    return () => clearInterval(timer);
  }, [running, index]);
  const next = (delta: number) =>
    setIndex((i) => (i + delta + slides.length) % slides.length);
  return (
    <section
      className={s.hero}
      aria-roledescription="carousel"
      aria-label="Featured jewellery"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setFocused(false);
      }}
      onTouchStart={(e) => {
        touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }}
      onTouchEnd={(e) => {
        if (!touch.current) return;
        const dx = e.changedTouches[0].clientX - touch.current.x;
        const dy = e.changedTouches[0].clientY - touch.current.y;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy))
          next(dx < 0 ? 1 : -1);
        touch.current = null;
      }}
    >
      <div className={s.heroSlides}>
        {slides.map((slide, i) => (
          <article
            key={slide.id}
            className={`${s.heroSlide} ${i === index ? s.activeSlide : ""}`}
            aria-hidden={i !== index}
            inert={i !== index}
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${slides.length}`}
          >
            <div className={s.heroCopy}>
              <p className={s.eyebrow}>{slide.eyebrow}</p>
              <h1>
                {slide.title.split("\n").map((line, j) => (
                  <span key={j}>{line}</span>
                ))}
              </h1>
              <p className={s.heroDescription}>{slide.description}</p>
              <Link className={s.darkButton} href={slide.href}>
                {slide.cta}
                <Icon name="arrow" size={17} />
              </Link>
            </div>
            <Asset
              mobileSrc={slide.mobileImage}
              pictureClassName={s.heroVisual}
              src={slide.image}
              alt={slide.alt}
              width={1000}
              height={650}
              priority
              style={
                {
                  objectPosition: slide.position,
                  "--mobile-position": slide.mobilePosition,
                } as React.CSSProperties
              }
            />
          </article>
        ))}
      </div>
      <div className={s.heroControls}>
        <div className={s.dots}>
          {slides.map((slide, i) => (
            <button
              key={slide.id}
              aria-label={`Show slide ${i + 1}`}
              aria-current={i === index ? "true" : undefined}
              onClick={() => setIndex(i)}
            >
              <span />
            </button>
          ))}
          <span className={s.slideNumber}>
            0{index + 1} / 0{slides.length}
          </span>
        </div>
        <div className={s.controlGroup}>
          <button
            className={s.iconButton}
            onClick={() => setPaused((v) => !v)}
            aria-label={
              paused
                ? "Resume automatic slideshow"
                : "Pause automatic slideshow"
            }
            aria-pressed={paused}
          >
            <Icon name={paused ? "play" : "pause"} size={15} />
          </button>
          <button
            className={`${s.iconButton} ${s.previous}`}
            onClick={() => next(-1)}
            aria-label="Previous slide"
          >
            <Icon name="arrow" size={18} />
          </button>
          <button
            className={s.iconButton}
            onClick={() => next(1)}
            aria-label="Next slide"
          >
            <Icon name="arrow" size={18} />
          </button>
        </div>
      </div>
      <div className="sr-only" aria-live={running ? "off" : "polite"}>
        Slide {index + 1}: {slides[index].title.replace("\n", " ")}
      </div>
    </section>
  );
}
