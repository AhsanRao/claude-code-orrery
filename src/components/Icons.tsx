/**
 * Inline SVG sprite. One `<Sprite />` at the app root; `<Icon name>` anywhere.
 * Icons are simple 24px strokes so they read at 12px and take `currentColor`.
 */

const SYMBOLS: Record<string, string> = {
  file: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M10 13h6M10 17h6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
  pencil: '<path d="M4 20l4-1L19 8l-3-3L5 16z"/><path d="M14 7l3 3"/>',
  terminal: '<path d="M5 7l5 5-5 5"/><path d="M12 17h7"/>',
  globe:
    '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c3 3 3 14 0 17M12 3.5c-3 3-3 14 0 17"/>',
  spark: '<path d="M12 3l2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4z"/>',
  check: '<path d="M5 13l4 4L19 7"/>',
  dots: '<circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  flag: '<path d="M5 21V4h12l-2 4 2 4H5"/>',
  plug: '<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0z"/><path d="M12 17v4"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  sliders:
    '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
};

export function Sprite() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        {Object.entries(SYMBOLS).map(([id, body]) => (
          <symbol
            key={id}
            id={`ic-${id}`}
            viewBox="0 0 24 24"
            dangerouslySetInnerHTML={{ __html: body }}
          />
        ))}
        <filter id="halo" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="10" />
        </filter>
        <filter id="pglow" x="-200%" y="-200%" width="500%" height="500%">
          <feGaussianBlur stdDeviation="2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
    </svg>
  );
}

export function Icon({
  name,
  className = "",
  title,
}: {
  name: string;
  className?: string;
  title?: string;
}) {
  return (
    <svg
      className={`icon ${className}`}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title && <title>{title}</title>}
      <use href={`#ic-${name}`} />
    </svg>
  );
}

/** Icon positioned inside an SVG scene (uses `x/y/width/height`). */
export function SvgIcon({
  name,
  size,
  x = -size / 2,
  y = -size / 2,
  className = "",
}: {
  name: string;
  size: number;
  x?: number;
  y?: number;
  className?: string;
}) {
  return (
    <use
      href={`#ic-${name}`}
      x={x}
      y={y}
      width={size}
      height={size}
      className={`icon ${className}`}
    />
  );
}
