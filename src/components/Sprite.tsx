import { useState } from 'react';

export function Sprite({ src, alt, className }: { src?: string; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return <div className={`sprite sprite-fallback ${className ?? ''}`}>{alt.slice(0, 1)}</div>;
  }
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      onError={() => setFailed(true)}
      draggable={false}
    />
  );
}
