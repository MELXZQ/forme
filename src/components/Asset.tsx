"use client";
import { useState } from "react";
import Image from "next/image";
export function Asset({
  src,
  alt,
  width = 500,
  height = 500,
  className,
  priority = false,
  style,
  mobileSrc,
  pictureClassName,
}: {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  className?: string;
  priority?: boolean;
  style?: React.CSSProperties;
  mobileSrc?: string;
  pictureClassName?: string;
}) {
  const [failed, setFailed] = useState(false);
  const image = (
    <Image
      unoptimized
      src={failed ? "/images/fallback.svg" : src}
      alt={failed ? `${alt} — image unavailable` : alt}
      width={width}
      height={height}
      className={className}
      style={style}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      onError={() => setFailed(true)}
    />
  );
  return mobileSrc ? (
    <picture className={pictureClassName}>
      <source
        media="(max-width: 640px)"
        srcSet={failed ? "/images/fallback.svg" : mobileSrc}
      />
      {image}
    </picture>
  ) : (
    image
  );
}
