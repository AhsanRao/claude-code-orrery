/**
 * The bot character. Pure SVG, ~48×56 units centered on (0,0); the parent's
 * class (`live`, `done`, `sleep`, `waiting`, `root`) drives expression via CSS.
 */

interface BotProps {
  scale?: number;
  /** Random per-instance blink offset so a crowd doesn't blink in unison. */
  seed?: number;
}

export function Bot({ scale = 1, seed = 0 }: BotProps) {
  const delay = `${((seed % 97) / 97) * 3}s`;
  return (
    <g
      className="bot"
      transform={`scale(${scale}) translate(0 4)`}
      style={{ animationDelay: delay }}
    >
      <path className="ant" d="M0 -17v-8" />
      <circle className="atip" cy="-27" r="2.8" />
      <rect className="head" x="-15" y="-17" width="30" height="26" rx="9" />
      <g className="eyes">
        <ellipse
          className="eye"
          cx="-6"
          cy="-6.5"
          rx="2.7"
          ry="3.2"
          style={{ animationDelay: delay }}
        />
        <ellipse
          className="eye r"
          cx="6"
          cy="-6.5"
          rx="2.7"
          ry="3.2"
          style={{ animationDelay: delay }}
        />
        <path className="happy" d="M-9 -6q3 -4 6 0M3 -6q3 -4 6 0" />
        <path className="sleep" d="M-9 -6h6M3 -6h6" />
        <g className="wide">
          <circle cx="-6" cy="-6.5" r="3.6" />
          <circle cx="6" cy="-6.5" r="3.6" />
        </g>
      </g>
      <circle className="cheek" cx="-10.5" cy="-1" r="2" />
      <circle className="cheek" cx="10.5" cy="-1" r="2" />
      <path className="mouth" d="M-4 2.5q4 3 8 0" />
    </g>
  );
}

/** Small avatar for lists. */
export function BotAvatar({
  state,
  seed,
}: {
  state: "live" | "done" | "sleep" | "waiting" | "";
  seed: number;
}) {
  return (
    <svg className={`av ${state}`} viewBox="-24 -34 48 56" aria-hidden="true">
      <Bot seed={seed} />
    </svg>
  );
}
