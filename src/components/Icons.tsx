import React from "react";
import styles from "./Icons.module.css";

/* ═══════════════════════════════════════════════════════════════════════════
 *  SAKURA ICONS
 *
 *  Rules this set holds itself to:
 *
 *  1. NO TWO ICONS SHARE A PATH. The previous set had GuitarIcon,
 *     SaxophoneIcon, ViolinIcon and MusicNotesIcon all drawing the same
 *     Material note glyph — four names, one shape, so genre chips were
 *     indistinguishable. Every glyph here is drawn from its own primitive.
 *
 *  2. GENRE GLYPHS ARE SCENES, NOT SYMBOLS. A pianist seated at a keyboard, a
 *     DJ over a turntable, a drummer mid-strike. A scene carries meaning at a
 *     glance and gives the animation something real to do; an abstract mark
 *     can only spin.
 *
 *  3. ANIMATION IS PER-ICON AND PHYSICAL. Parts carry `data-part` and
 *     Icons.module.css drives each with keyframes matching what the object
 *     would actually do — piano keys depress, a tonearm drops, strings
 *     vibrate, a flame flickers. Nothing shares a generic hover-spin.
 *
 *  4. COLOUR IS OPT-IN AND SEMANTIC. Icons are `currentColor` by default so
 *     they theme for free. Genre/feature glyphs accept `tone` to paint a
 *     second accent — used where colour aids recognition (a genre grid), never
 *     as decoration.
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface IconProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  strokeWidth?: number;
  /** Solid variant, for active/selected states. */
  filled?: boolean;
  /** Accessible name. Omit for decorative icons. */
  title?: string;
  /** Secondary colour for two-tone glyphs. Defaults to currentColor at low alpha. */
  tone?: string;
}

function Svg({
  size = 24,
  className,
  style,
  strokeWidth = 1.8,
  title,
  children,
  fill = "none",
  viewBox = "0 0 24 24",
}: IconProps & {
  children: React.ReactNode;
  fill?: string;
  viewBox?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill={fill}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${styles.icon}${className ? ` ${className}` : ""}`}
      style={style}
      // Decorative by default; a `title` promotes it to an image with a name.
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

/* ── Transport ──────────────────────────────────────────────────────────────
 *
 * Solid, because transport controls are the one place where a filled shape
 * reads faster than an outline at speed.
 */

export function PlayIcon(p: IconProps) {
  return (
    <Svg {...p} fill="currentColor">
      <path
        d="M7.6 5.4v13.2a1.1 1.1 0 0 0 1.68.94l10.5-6.6a1.1 1.1 0 0 0 0-1.88L9.28 4.46A1.1 1.1 0 0 0 7.6 5.4Z"
        stroke="none"
      />
    </Svg>
  );
}

export function PauseIcon(p: IconProps) {
  return (
    <Svg {...p} fill="currentColor">
      <rect x="6.4" y="4.8" width="4" height="14.4" rx="1.7" stroke="none" />
      <rect x="13.6" y="4.8" width="4" height="14.4" rx="1.7" stroke="none" />
    </Svg>
  );
}

export function NextIcon(p: IconProps) {
  return (
    <Svg {...p} fill="currentColor">
      <path
        data-part="skip-fwd"
        d="M5 6.3v11.4a1 1 0 0 0 1.54.85l9-5.7a1 1 0 0 0 0-1.7l-9-5.7A1 1 0 0 0 5 6.3Z"
        stroke="none"
      />
      <rect x="16.9" y="4.9" width="2.9" height="14.2" rx="1.45" stroke="none" />
    </Svg>
  );
}

export function PrevIcon(p: IconProps) {
  return (
    <Svg {...p} fill="currentColor">
      <path
        data-part="skip-back"
        d="M19 6.3v11.4a1 1 0 0 1-1.54.85l-9-5.7a1 1 0 0 1 0-1.7l9-5.7A1 1 0 0 1 19 6.3Z"
        stroke="none"
      />
      <rect x="4.2" y="4.9" width="2.9" height="14.2" rx="1.45" stroke="none" />
    </Svg>
  );
}

export function ShuffleIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M16.4 3.4 19.9 6.9l-3.5 3.5" />
      <path d="M16.4 13.6 19.9 17.1l-3.5 3.5" />
      <path
        data-part="loop-path"
        d="M19.9 6.9h-3c-1.9 0-3.6 1-4.6 2.6l-3.6 5.9c-1 1.6-2.7 2.6-4.6 2.6H3.9"
      />
      <path d="M3.9 6.9H5c1.9 0 3.6 1 4.6 2.6l.5.8" />
      <path d="M13.5 14.6l.7 1.1c1 1.6 2.7 2.6 4.6 2.6h1.1" />
    </Svg>
  );
}

export function RepeatIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M17 2.4 20.6 6 17 9.6" />
      <path data-part="loop-path" d="M3.4 12.6V11a5 5 0 0 1 5-5h12.2" />
      <path d="M7 21.6 3.4 18 7 14.4" />
      <path data-part="loop-path" d="M20.6 11.4V13a5 5 0 0 1-5 5H3.4" />
    </Svg>
  );
}

export function RepeatOneIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M17 2.4 20.6 6 17 9.6" />
      <path d="M3.4 12.6V11a5 5 0 0 1 5-5h12.2" />
      <path d="M7 21.6 3.4 18 7 14.4" />
      <path d="M20.6 11.4V13a5 5 0 0 1-5 5H3.4" />
      <path d="M11.1 10.5l1.4-1V15" strokeWidth={1.6} />
    </Svg>
  );
}

/* ── State ──────────────────────────────────────────────────────────────── */

export function HeartIcon({ filled, ...p }: IconProps) {
  return (
    <Svg {...p} fill={filled ? "currentColor" : "none"}>
      <path
        data-part="heart"
        d="M12 20.6C12 20.6 3.4 15.9 3.4 10.3a4.9 4.9 0 0 1 8.6-3.2 4.9 4.9 0 0 1 8.6 3.2c0 5.6-8.6 10.3-8.6 10.3Z"
      />
    </Svg>
  );
}

/**
 * A five-petal blossom. This is the app's signature mark — the like action
 * uses it, and the petal-burst confirmation animation is built from the same
 * shape, so the gesture and its feedback share a vocabulary.
 */
export function PetalIcon({ filled, tone, ...p }: IconProps) {
  return (
    <Svg {...p} fill={filled ? "currentColor" : "none"}>
      {[0, 72, 144, 216, 288].map((deg, i) => (
        <path
          key={deg}
          data-part="petal"
          style={{ ["--petal-rot" as string]: `${deg}deg`, animationDelay: `${i * 0.09}s` }}
          d="M12 12.2c-1.85-1.15-2.9-2.9-2.9-4.7 0-1.75 1.3-3.1 2.9-3.1s2.9 1.35 2.9 3.1c0 1.8-1.05 3.55-2.9 4.7Z"
          transform={`rotate(${deg} 12 12)`}
        />
      ))}
      <circle cx="12" cy="12" r="1.5" fill={tone || "currentColor"} stroke="none" opacity={filled ? 0.45 : 1} />
    </Svg>
  );
}

export function CheckIcon(p: IconProps) {
  return (
    <Svg {...p} strokeWidth={p.strokeWidth ?? 2.1}>
      <path d="M4.6 12.7l4.7 4.7L19.4 6.9" />
    </Svg>
  );
}

/**
 * Password visibility. Two glyphs rather than one rotated or crossed variant,
 * because the lid is what actually differs: open is an almond with an iris,
 * closed is a lowered lid with lashes. A slash through an open eye is the
 * conventional drawing and it reads as "eye is forbidden" rather than "the
 * password is hidden".
 */
export function EyeIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path data-part="lid" d="M2.4 12S6.3 5.9 12 5.9 21.6 12 21.6 12 17.7 18.1 12 18.1 2.4 12 2.4 12Z" />
      <circle data-part="iris" cx="12" cy="12" r="2.7" />
    </Svg>
  );
}

export function EyeOffIcon(p: IconProps) {
  return (
    <Svg {...p}>
      {/* A closed lid: the same curve as the open eye's lower edge, alone. */}
      <path data-part="lid" d="M2.9 10.4c2.4 2.9 5.4 4.4 9.1 4.4s6.7-1.5 9.1-4.4" />
      <path d="M5.2 13.6 3.9 15.7" />
      <path d="M12 14.8v2.5" />
      <path d="M18.8 13.6l1.3 2.1" />
    </Svg>
  );
}

export function CheckCircleIcon({ filled, ...p }: IconProps) {
  return (
    <Svg {...p} fill={filled ? "currentColor" : "none"}>
      <circle cx="12" cy="12" r="9" />
      <path
        d="M8.1 12.3l2.8 2.8 5.1-5.5"
        stroke={filled ? "var(--bg)" : "currentColor"}
        strokeWidth={2}
      />
    </Svg>
  );
}

export function CloseIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6.2 6.2l11.6 11.6M17.8 6.2 6.2 17.8" />
    </Svg>
  );
}

export function PlusIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <g data-part="plus">
        <path d="M12 5.2v13.6M5.2 12h13.6" />
      </g>
    </Svg>
  );
}

export function MinusIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5.2 12h13.6" />
    </Svg>
  );
}

export function InfoIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11.2v5" />
      <circle cx="12" cy="7.9" r="0.95" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function AlertIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3.6 21.2 19.4a1.2 1.2 0 0 1-1.05 1.8H3.85a1.2 1.2 0 0 1-1.05-1.8Z" />
      <path d="M12 9.6v4.2" />
      <circle cx="12" cy="17.2" r="0.95" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function LockIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="4.4" y="10.4" width="15.2" height="10.4" rx="2.6" />
      <path d="M8 10.4V7.6a4 4 0 0 1 8 0v2.8" />
      <circle cx="12" cy="15.6" r="1.3" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/* ── Navigation ─────────────────────────────────────────────────────────── */

export function HomeIcon({ filled, ...p }: IconProps) {
  return (
    <Svg {...p} fill={filled ? "currentColor" : "none"}>
      <path d="M3.4 10.3 12 3.5l8.6 6.8v8.4a1.8 1.8 0 0 1-1.8 1.8H5.2a1.8 1.8 0 0 1-1.8-1.8Z" />
      <path
        d="M9.3 20.5v-5.7a1.35 1.35 0 0 1 1.35-1.35h2.7a1.35 1.35 0 0 1 1.35 1.35v5.7"
        fill="none"
        stroke={filled ? "var(--bg)" : "currentColor"}
      />
    </Svg>
  );
}

export function SearchIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle data-part="lens" cx="10.7" cy="10.7" r="6.9" />
      <path d="M15.7 15.7 20.9 20.9" />
    </Svg>
  );
}

export function LibraryIcon({ filled, ...p }: IconProps) {
  return (
    <Svg {...p} fill={filled ? "currentColor" : "none"}>
      <rect x="3.2" y="4.4" width="3.7" height="15.2" rx="1.4" />
      <rect x="8.9" y="4.4" width="3.7" height="15.2" rx="1.4" />
      <path d="M15.6 5.4l2.7-.7a1.3 1.3 0 0 1 1.6.93l2.1 7.9a1.3 1.3 0 0 1-.93 1.6l-2.7.72" />
    </Svg>
  );
}

export function UserIcon({ filled, ...p }: IconProps) {
  return (
    <Svg {...p} fill={filled ? "currentColor" : "none"}>
      <circle cx="12" cy="8.2" r="4.1" />
      <path d="M4.6 20.4a7.4 7.4 0 0 1 14.8 0" />
    </Svg>
  );
}

export function ChevronDownIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path data-part="chev-d" d="M5.6 9.2 12 15.6 18.4 9.2" />
    </Svg>
  );
}

export function ChevronUpIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5.6 14.8 12 8.4 18.4 14.8" />
    </Svg>
  );
}

export function ChevronRightIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path data-part="chev-r" d="M9.2 5.6 15.6 12 9.2 18.4" />
    </Svg>
  );
}

export function ChevronLeftIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path data-part="chev-l" d="M14.8 5.6 8.4 12 14.8 18.4" />
    </Svg>
  );
}

export function ArrowLeftIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <g data-part="chev-l">
        <path d="M19.4 12H4.6" />
        <path d="M10.6 5.8 4.4 12l6.2 6.2" />
      </g>
    </Svg>
  );
}

export function ArrowRightIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <g data-part="chev-r">
        <path d="M4.6 12h14.8" />
        <path d="M13.4 5.8 19.6 12l-6.2 6.2" />
      </g>
    </Svg>
  );
}

/**
 * Downward arrow. Its own geometry rather than a rotated `ArrowLeftIcon`:
 * a rotation would inherit that glyph's `chev-l` animation part and slide
 * sideways when triggered, which is wrong for a control that means "come back
 * down to the current line".
 */
export function ArrowDownIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <g data-part="chev-d">
        <path d="M12 4.6v14.8" />
        <path d="M5.8 13.4 12 19.6l6.2-6.2" />
      </g>
    </Svg>
  );
}

export function MoreIcon(p: IconProps) {
  return (
    <Svg {...p} fill="currentColor">
      <circle data-part="node-1" cx="12" cy="5.2" r="1.85" stroke="none" />
      <circle data-part="node-2" cx="12" cy="12" r="1.85" stroke="none" />
      <circle data-part="node-3" cx="12" cy="18.8" r="1.85" stroke="none" />
    </Svg>
  );
}

export function MoreHorizontalIcon(p: IconProps) {
  return (
    <Svg {...p} fill="currentColor">
      <circle data-part="node-1" cx="5.2" cy="12" r="1.85" stroke="none" />
      <circle data-part="node-2" cx="12" cy="12" r="1.85" stroke="none" />
      <circle data-part="node-3" cx="18.8" cy="12" r="1.85" stroke="none" />
    </Svg>
  );
}

/* ── Content types ──────────────────────────────────────────────────────── */

export function MusicNoteIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="6.9" cy="17.6" r="3.1" />
      <path d="M10 17.6V5.2l9.5-2.2v10.1" />
      <circle cx="16.4" cy="13.1" r="3.1" />
    </Svg>
  );
}

/** A record with a visible spindle and groove — reads as "album" at 16px. */
export function AlbumIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <g data-part="disc">
        <circle cx="12" cy="12" r="8.9" />
        <circle cx="12" cy="12" r="3.3" />
        <path d="M12 3.1a8.9 8.9 0 0 1 7.3 3.85" opacity="0.42" />
      </g>
      <circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function DiscIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <g data-part="disc">
        <circle cx="12" cy="12" r="8.9" />
        <path d="M12 3.1a8.9 8.9 0 0 1 6.3 2.6" opacity="0.5" />
        <path d="M12 20.9a8.9 8.9 0 0 1-6.3-2.6" opacity="0.5" />
      </g>
      <circle cx="12" cy="12" r="2.2" />
    </Svg>
  );
}

export function PlaylistIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.5 6.4h11M3.5 11.4h11M3.5 16.4h6.4" />
      <circle cx="17.3" cy="17.1" r="2.85" />
      <path d="M20.15 17.1V8.9l-4.5 1.2" />
    </Svg>
  );
}

export function QueueIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.5 6.4h12M3.5 11.4h12M3.5 16.4h7" />
      <circle cx="17.9" cy="16.8" r="2.7" />
      <path d="M20.6 16.8V8.4" />
    </Svg>
  );
}

/** Vocal mic: capsule, grille lines, yoke and stand. */
export function MicrophoneIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle data-part="mic-ring" cx="12" cy="8" r="7" opacity="0.28" strokeWidth={1.3} />
      <rect x="9.1" y="2.6" width="5.8" height="11" rx="2.9" />
      <path d="M10.5 5.6h3M10.5 8h3" opacity="0.55" strokeWidth={1.2} />
      <path d="M5.6 11.3a6.4 6.4 0 0 0 12.8 0" />
      <path d="M12 17.8v3.4M8.9 21.2h6.2" />
    </Svg>
  );
}

export function HeadphonesIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.7 15.3v-2.9a8.3 8.3 0 0 1 16.6 0v2.9" />
      <rect data-part="cup-l" x="2.6" y="14.3" width="4.6" height="6.4" rx="2.3" />
      <rect data-part="cup-r" x="16.8" y="14.3" width="4.6" height="6.4" rx="2.3" />
    </Svg>
  );
}

export function RadioIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
      <g data-part="wave-1">
        <path d="M8 8a5.6 5.6 0 0 0 0 8M16 16a5.6 5.6 0 0 0 0-8" />
      </g>
      <g data-part="wave-2">
        <path d="M5.1 5.1a9.7 9.7 0 0 0 0 13.8M18.9 18.9a9.7 9.7 0 0 0 0-13.8" />
      </g>
    </Svg>
  );
}

/* ── Accents / feedback ─────────────────────────────────────────────────── */

export function SparklesIcon({ tone, ...p }: IconProps) {
  return (
    <Svg {...p}>
      <path
        data-part="spark-1"
        d="M12 3.1 13.75 8.25 18.9 10 13.75 11.75 12 16.9 10.25 11.75 5.1 10 10.25 8.25Z"
        fill={tone}
        stroke={tone ? "none" : "currentColor"}
      />
      <path data-part="spark-2" d="M18.4 15.3l.72 2.03 2.03.72-2.03.72-.72 2.03-.72-2.03-2.03-.72 2.03-.72Z" />
      <path data-part="spark-3" d="M5.5 2.9l.52 1.5 1.5.52-1.5.52L5.5 6.94l-.52-1.5-1.5-.52 1.5-.52Z" />
    </Svg>
  );
}

export function FireIcon({ tone, ...p }: IconProps) {
  return (
    <Svg {...p}>
      <path
        data-part="flame"
        d="M12 21.2c3.5 0 6.2-2.5 6.2-6 0-4.4-4-6.5-4.9-11.4-2.2 1.6-3.6 3.9-3.6 6.1 0 1.3-.9 2-1.8 2-.9 0-1.5-.6-1.7-1.5-.9 1.4-1.4 3-1.4 4.8 0 3.5 2.7 6 7.2 6Z"
      />
      <path
        d="M12 21.2c1.8 0 3-1.2 3-2.9 0-2-1.9-2.8-2.4-5.2-1.4 1.1-2.4 2.5-2.4 4.1 0 2.2 1 4 1.8 4Z"
        fill={tone}
        stroke={tone ? "none" : "currentColor"}
        opacity={tone ? 1 : 0.55}
      />
    </Svg>
  );
}

export function LightningIcon({ filled, ...p }: IconProps) {
  return (
    <Svg {...p} fill={filled ? "currentColor" : "none"}>
      <path data-part="flame" d="M13.2 2.4 4.8 13.2h5.6l-.8 8.4 8.6-11h-5.8Z" />
    </Svg>
  );
}

export function CloudIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path
        data-part="cloud"
        d="M7 18.4h10.2a4 4 0 0 0 .5-8 6 6 0 0 0-11.4-1.3A3.9 3.9 0 0 0 7 18.4Z"
      />
    </Svg>
  );
}

export function GlobeIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.9" />
      <path d="M3.3 12h17.4" />
      <ellipse data-part="meridian" cx="12" cy="12" rx="3.7" ry="8.9" />
    </Svg>
  );
}

export function PhoneIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="6.3" y="2.3" width="11.4" height="19.4" rx="2.8" />
      <path d="M10.3 5.3h3.4" />
      <circle cx="12" cy="18.4" r="0.9" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/**
 * Script conversion — a CJK-style glyph beside a Latin "A", which is literally
 * what the control does. Deliberately not GlobeIcon: a globe means "region" or
 * "language", not "rewrite this in another alphabet".
 */
export function LanguageIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <g data-part="glyph-src">
        <path d="M3.4 6.1h7.2" />
        <path d="M7 4.2v1.9" />
        <path d="M9.1 6.1c0 3.3-2 5.9-5.7 7.1" />
        <path d="M5.2 9.6c1 1.9 2.6 3.1 5.1 3.8" />
      </g>
      <g data-part="glyph-dst">
        <path d="M13.2 19.8l3.5-8.4 3.5 8.4" />
        <path d="M14.5 16.7h4.4" />
      </g>
    </Svg>
  );
}

/**
 * Indeterminate progress. An open arc rather than a ring of dots — the gap is
 * what makes the rotation legible, and this is the one place in the set where
 * a spin is the honest depiction of what's happening rather than filler.
 */
export function SpinnerIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path data-part="spin" d="M12 3.4a8.6 8.6 0 1 1-8.6 8.6" />
    </Svg>
  );
}

export function DatabaseIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <ellipse cx="12" cy="5.8" rx="7.4" ry="3.2" />
      <path d="M4.6 5.8v12.4c0 1.8 3.3 3.2 7.4 3.2s7.4-1.4 7.4-3.2V5.8" />
      <path d="M4.6 12c0 1.8 3.3 3.2 7.4 3.2s7.4-1.4 7.4-3.2" />
    </Svg>
  );
}

export function ClockIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.9" />
      <path d="M12 6.9V12l3.4 2.1" />
    </Svg>
  );
}

export function CalendarIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3.4" y="5.2" width="17.2" height="15.4" rx="2.4" />
      <path d="M3.4 9.8h17.2M8.2 2.8v4M15.8 2.8v4" />
    </Svg>
  );
}

/* ── Actions ────────────────────────────────────────────────────────────── */

export function DownloadIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <g data-part="dl-arrow">
        <path d="M12 3.4v11.2" />
        <path d="M7.7 10.5 12 14.8l4.3-4.3" />
      </g>
      <path d="M4.2 17.2v1.8a2 2 0 0 0 2 2h11.6a2 2 0 0 0 2-2v-1.8" />
    </Svg>
  );
}

export function DownloadedIcon(p: IconProps) {
  return (
    <Svg {...p} fill="currentColor">
      <circle cx="12" cy="12" r="9" stroke="none" />
      <path
        d="M8.1 12.3l2.7 2.7 5.1-5.5"
        stroke="var(--bg)"
        fill="none"
        strokeWidth={2.2}
      />
    </Svg>
  );
}

/** Node-graph share mark. The three nodes light in sequence when animated. */
export function ShareIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle data-part="node-1" cx="17.9" cy="5.4" r="2.7" />
      <circle data-part="node-2" cx="6.1" cy="12" r="2.7" />
      <circle data-part="node-3" cx="17.9" cy="18.6" r="2.7" />
      <path d="M8.5 13.3l7 3.9M15.5 6.8l-7 3.9" opacity="0.75" />
    </Svg>
  );
}

/** Upward tray — "send out of the app". Matches the iOS share affordance. */
export function ShareUpIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <g data-part="dl-arrow">
        <path d="M12 15V3.6" />
        <path d="M8.2 7.4 12 3.6l3.8 3.8" />
      </g>
      <path d="M6.2 10.6H5.4a2 2 0 0 0-2 2v6.4a2 2 0 0 0 2 2h13.2a2 2 0 0 0 2-2v-6.4a2 2 0 0 0-2-2h-.8" />
    </Svg>
  );
}

export function TimerIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="13.4" r="8.1" />
      <path d="M12 9v4.4l2.8 1.8" />
      <path d="M9.2 2.4h5.6M12 2.4v2.8" />
    </Svg>
  );
}

export function VolumeIcon({ level = 1, ...p }: IconProps & { level?: number }) {
  return (
    <Svg {...p}>
      <path d="M11 4.6 6.4 8.6H3.2v6.8h3.2L11 19.4Z" />
      {level > 0.02 && <path data-part="wave-1" d="M14.6 9.4a3.6 3.6 0 0 1 0 5.2" />}
      {level > 0.5 && <path data-part="wave-2" d="M17.4 6.4a7.6 7.6 0 0 1 0 11.2" />}
      {level <= 0.02 && <path d="M15.4 9.6 20.4 14.6M20.4 9.6l-5 5" />}
    </Svg>
  );
}

export function TrashIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <g data-part="lid">
        <path d="M3.8 6.4h16.4" />
        <path d="M8.4 6.4V4.6a1.6 1.6 0 0 1 1.6-1.6h4a1.6 1.6 0 0 1 1.6 1.6v1.8" />
      </g>
      <path d="M5.8 6.4l.9 13a1.8 1.8 0 0 0 1.8 1.6h7a1.8 1.8 0 0 0 1.8-1.6l.9-13" />
      <path d="M10.4 10.6v6M13.6 10.6v6" opacity="0.65" />
    </Svg>
  );
}

export function EditIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 20h4.2L19.4 8.8a2.4 2.4 0 0 0-3.4-3.4L4.8 16.6Z" />
      <path d="M14.8 6.6l3.4 3.4" />
    </Svg>
  );
}

export function FolderIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path
        data-part="flap"
        d="M3.4 8.2V6.4a2 2 0 0 1 2-2h3.4l2.2 2.6h7.6a2 2 0 0 1 2 2v9.6a2 2 0 0 1-2 2H5.4a2 2 0 0 1-2-2Z"
      />
    </Svg>
  );
}

export function OfflineIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 3l18 18" />
      <path d="M6.8 11.4a9 9 0 0 1 3-1.9" />
      <path d="M3.4 8.2A14 14 0 0 1 8 5.3" />
      <path d="M14.4 9.8a9 9 0 0 1 2.8 1.6" />
      <path d="M13 5.2a14 14 0 0 1 7.6 3" />
      <path d="M9.8 14.6a4.4 4.4 0 0 1 4.6.6" />
      <circle cx="12" cy="19.2" r="0.9" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function WifiIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path data-part="wave-3" d="M3.4 8.4a14 14 0 0 1 17.2 0" />
      <path data-part="wave-2" d="M6.6 11.8a9.4 9.4 0 0 1 10.8 0" />
      <path data-part="wave-1" d="M9.8 15.2a4.6 4.6 0 0 1 4.4 0" />
      <circle cx="12" cy="18.8" r="0.9" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function ThumbDownIcon({ filled, ...p }: IconProps) {
  return (
    <Svg {...p} fill={filled ? "currentColor" : "none"}>
      <path d="M7.2 3.4h8.4l2.4 9H12l.8 4.6a2.2 2.2 0 0 1-4.2 1.1L7.2 14.4Z" />
      <rect x="17.6" y="3.4" width="3.4" height="9" rx="1.4" />
    </Svg>
  );
}

export function SortIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M7 4.6v14.8M3.6 16l3.4 3.4L10.4 16" />
      <path d="M17 19.4V4.6M13.6 8 17 4.6 20.4 8" />
    </Svg>
  );
}

export function DragHandleIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 8.5h8M8 12h8M8 15.5h8" />
    </Svg>
  );
}

export function FilterIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.4 5.4h17.2l-6.6 7.8v6.2l-4-2.2v-4Z" />
    </Svg>
  );
}

export function ImageIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3.2" y="4.4" width="17.6" height="15.2" rx="2.4" />
      <circle cx="8.5" cy="9.5" r="1.7" />
      <path d="M3.4 16.6l4.8-4.2a2 2 0 0 1 2.7.06l6 5.6" />
    </Svg>
  );
}

export function VideoIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="2.6" y="5.4" width="13.4" height="13.2" rx="2.4" />
      <path d="M16 10.6l4.2-2.6a.9.9 0 0 1 1.4.76v6.5a.9.9 0 0 1-1.4.76L16 13.4Z" />
    </Svg>
  );
}

export function LinkIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M10.2 13.8a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.4 1.4" />
      <path d="M13.8 10.2a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.4-1.4" />
    </Svg>
  );
}

export function CopyIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="8.6" y="8.6" width="12" height="12" rx="2.2" />
      <path d="M15.4 5.6V5a1.6 1.6 0 0 0-1.6-1.6H5A1.6 1.6 0 0 0 3.4 5v8.8A1.6 1.6 0 0 0 5 15.4h.6" />
    </Svg>
  );
}

export function SettingsIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <g data-part="cog">
        <path d="M19.2 14.6a1.6 1.6 0 0 0 .32 1.76l.06.06a1.9 1.9 0 1 1-2.7 2.7l-.06-.06a1.6 1.6 0 0 0-1.76-.32 1.6 1.6 0 0 0-1 1.46v.18a1.9 1.9 0 1 1-3.8 0v-.1a1.6 1.6 0 0 0-1.05-1.46 1.6 1.6 0 0 0-1.76.32l-.06.06a1.9 1.9 0 1 1-2.7-2.7l.06-.06a1.6 1.6 0 0 0 .32-1.76 1.6 1.6 0 0 0-1.46-1H3.4a1.9 1.9 0 1 1 0-3.8h.1a1.6 1.6 0 0 0 1.46-1.05 1.6 1.6 0 0 0-.32-1.76l-.06-.06a1.9 1.9 0 1 1 2.7-2.7l.06.06a1.6 1.6 0 0 0 1.76.32h.08a1.6 1.6 0 0 0 1-1.46V3.4a1.9 1.9 0 1 1 3.8 0v.1a1.6 1.6 0 0 0 1 1.46 1.6 1.6 0 0 0 1.76-.32l.06-.06a1.9 1.9 0 1 1 2.7 2.7l-.06.06a1.6 1.6 0 0 0-.32 1.76v.08a1.6 1.6 0 0 0 1.46 1h.18a1.9 1.9 0 1 1 0 3.8h-.1a1.6 1.6 0 0 0-1.46 1Z" />
      </g>
      <circle cx="12" cy="12" r="3.1" />
    </Svg>
  );
}

export function LogOutIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9.4 20.6H5.6a2 2 0 0 1-2-2V5.4a2 2 0 0 1 2-2h3.8" />
      <g data-part="chev-r">
        <path d="M15.8 16.4 20.4 12l-4.6-4.4" />
        <path d="M20.4 12H9.2" />
      </g>
    </Svg>
  );
}

export function SunIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="4.2" />
      <g data-part="cog">
        <path d="M12 2.4v2.2M12 19.4v2.2M2.4 12h2.2M19.4 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6" />
      </g>
    </Svg>
  );
}

export function MoonIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M20.4 13.4A8.6 8.6 0 0 1 10.6 3.6a8.8 8.8 0 1 0 9.8 9.8Z" />
    </Svg>
  );
}

/**
 * "Follow the system" — a disc split light/dark down the middle. Reads as a
 * relationship between the two themes rather than as a third theme.
 */
export function ContrastIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.9" />
      <path
        d="M12 3.1a8.9 8.9 0 0 1 0 17.8Z"
        fill="currentColor"
        stroke="none"
      />
    </Svg>
  );
}

/** Painter's palette with three wells — appearance and theming. */
export function PaletteIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3.1a8.9 8.9 0 0 0 0 17.8 1.9 1.9 0 0 0 1.9-1.9 1.5 1.5 0 0 1 1.5-1.5h1.7a3 3 0 0 0 3-3A8.9 8.9 0 0 0 12 3.1Z" />
      <circle data-part="spark-1" cx="7.6" cy="12.2" r="1.05" fill="currentColor" stroke="none" />
      <circle data-part="spark-2" cx="10.4" cy="7.9" r="1.05" fill="currentColor" stroke="none" />
      <circle data-part="spark-3" cx="15.4" cy="9.4" r="1.05" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/**
 * Speaker with radiating arcs. Distinct from `VolumeIcon`, which is a live
 * level readout whose arcs appear and disappear with the value; this one is a
 * static section marker for playback settings.
 */
export function SoundIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M11 4.6 6.4 8.6H3.2v6.8h3.2L11 19.4Z" />
      <path data-part="wave-1" d="M14.6 9.4a3.6 3.6 0 0 1 0 5.2" />
      <path data-part="wave-2" d="M17.4 6.4a7.6 7.6 0 0 1 0 11.2" />
    </Svg>
  );
}

export function BellIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <g data-part="bell">
        <path d="M18.2 9.4a6.2 6.2 0 1 0-12.4 0c0 6.4-2.4 8.2-2.4 8.2h17.2s-2.4-1.8-2.4-8.2Z" />
      </g>
      <path d="M13.9 20.8a2.2 2.2 0 0 1-3.8 0" />
    </Svg>
  );
}

export function ShieldIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 2.8 4.4 6v6c0 4.6 3.2 8.4 7.6 9.6 4.4-1.2 7.6-5 7.6-9.6V6Z" />
      <path d="M8.9 12.1l2.2 2.2 4-4.4" />
    </Svg>
  );
}

export function DocumentIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M13.6 2.8H6.8a2 2 0 0 0-2 2v14.4a2 2 0 0 0 2 2h10.4a2 2 0 0 0 2-2V8.4Z" />
      <path d="M13.6 2.8v5.6h5.6" />
      <path d="M8.4 13h7.2M8.4 16.6h4.8" opacity="0.6" />
    </Svg>
  );
}

export function LyricsIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.6 5.6h11.2M3.6 10h8.4M3.6 14.4h11.2M3.6 18.8h6" />
      <circle cx="18.4" cy="17.4" r="2.6" />
      <path d="M21 17.4V7.6l-4.6 1.4" opacity="0.8" />
    </Svg>
  );
}

/* ── Brand ──────────────────────────────────────────────────────────────── */

/** Five-petal cherry blossom. The one mark that fills by default. */
export function SakuraIcon({ size = 24, className, style, title, tone }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={`${styles.icon}${className ? ` ${className}` : ""}`}
      style={style}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {[0, 72, 144, 216, 288].map((deg, i) => (
        <path
          key={deg}
          data-part="petal"
          style={{ ["--petal-rot" as string]: `${deg}deg`, animationDelay: `${i * 0.1}s` }}
          d="M12 12c-1.9-1.1-3-2.9-3-4.8 0-1.8 1.3-3.2 3-3.2s3 1.4 3 3.2c0 1.9-1.1 3.7-3 4.8Z"
          transform={`rotate(${deg} 12 12)`}
        />
      ))}
      <circle cx="12" cy="12" r="1.7" fill={tone || "var(--bg, #0c0a0d)"} />
    </svg>
  );
}

/* ═══ GENRE SCENES ═════════════════════════════════════════════════════════
 *
 * Each is a small illustration rather than a symbol: a figure, an instrument,
 * an action. Drawn on a 32-unit grid so there's room for a scene without the
 * strokes crowding. They accept `tone` for a second colour, used by the
 * search grid where colour is a genuine recognition aid.
 */

function Scene({
  size = 32,
  className,
  style,
  title,
  children,
  strokeWidth = 1.6,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${styles.icon}${className ? ` ${className}` : ""}`}
      style={style}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

/**
 * CLASSICAL — a seated pianist at a grand.
 * The keys depress in sequence, the head nods, the arms rock. This is the
 * icon the brief asked for by name, and it sets the bar for the rest.
 */
export function ClassicalIcon({ tone, ...p }: IconProps) {
  return (
    <Scene {...p}>
      {/* pianist */}
      <circle data-part="head" cx="16" cy="6.4" r="2.9" />
      <path d="M11.4 16.2v-1.9a4.6 4.6 0 0 1 9.2 0v1.9" />
      <path data-part="arm-l" d="M11.6 14.4 8.9 18.6" />
      <path data-part="arm-r" d="M20.4 14.4 23.1 18.6" />
      {/* piano body */}
      <path d="M5.4 19.4h21.2a1.5 1.5 0 0 1 1.5 1.5v4.3a1.5 1.5 0 0 1-1.5 1.5H5.4a1.5 1.5 0 0 1-1.5-1.5v-4.3a1.5 1.5 0 0 1 1.5-1.5Z" fill={tone} />
      {/* keys */}
      <path data-part="key-1" d="M9.6 19.6v4.2" />
      <path data-part="key-2" d="M14.4 19.6v4.2" />
      <path data-part="key-3" d="M19.2 19.6v4.2" />
      <path d="M24 19.6v4.2" opacity="0.5" />
      <path d="M3.9 23.8h24.2" />
      {/* legs */}
      <path d="M6.6 26.7v2.4M25.4 26.7v2.4" opacity="0.6" />
    </Scene>
  );
}

/**
 * HIP-HOP — a DJ leaning over a turntable, one hand on the platter.
 * The platter spins; the tonearm drops in on hover.
 */
export function HipHopIcon({ tone, ...p }: IconProps) {
  return (
    <Scene {...p}>
      {/* DJ */}
      <circle cx="9.2" cy="6.6" r="2.8" />
      <path data-part="arm-r" d="M9.4 10.4c2.6 0 4 1.5 4.4 3.6l.6 3.1" />
      <path d="M5.6 17.4v-3a3.7 3.7 0 0 1 3.7-3.7" />
      {/* deck */}
      <rect x="3.4" y="18" width="25.2" height="10.4" rx="2.2" fill={tone} />
      <g data-part="platter">
        <circle cx="12.4" cy="23.2" r="4.2" />
        <circle cx="12.4" cy="23.2" r="0.9" fill="currentColor" stroke="none" />
        <path d="M12.4 19a4.2 4.2 0 0 1 3.5 1.9" opacity="0.5" />
      </g>
      {/* tonearm */}
      <g data-part="tonearm">
        <path d="M25.4 20.1 17.2 24" />
        <circle cx="25.9" cy="19.9" r="1.3" />
      </g>
      {/* faders */}
      <path d="M21 26.4h5.4" opacity="0.55" />
    </Scene>
  );
}

/**
 * ROCK — a guitarist mid-stance, headstock raised. Strings vibrate.
 */
export function RockIcon({ tone, ...p }: IconProps) {
  return (
    <Scene {...p}>
      {/* player */}
      <circle cx="10.6" cy="5.8" r="2.7" />
      <path d="M6.6 16.6v-2.4a4 4 0 0 1 8 0" />
      {/* guitar body */}
      <path
        d="M12.4 22.6c-2.6.8-4.3 3-4.3 5.5 0 .5 0 .5.5.5 3.4 0 6-1.6 7.3-3.6"
        fill={tone}
      />
      <path d="M20.9 21.9c1.6-1.9 1.3-4.5-.7-5.9-1.8-1.3-4.1-1.1-5.6.2-1.4 1.3-3.4 2.6-4.6 4" />
      {/* neck + headstock */}
      <path d="M19.6 15.2 26.4 8" />
      <path d="M25.1 6.4 28.2 9.5" />
      <path d="M26.6 5 29 7.4" />
      {/* strings */}
      <path data-part="string-1" d="M13.6 20.4 21.2 12.9" opacity="0.55" strokeWidth={1} />
      <path data-part="string-2" d="M14.9 21.6 22.4 14.1" opacity="0.55" strokeWidth={1} />
      <circle cx="14.4" cy="24.4" r="1.6" />
    </Scene>
  );
}

/**
 * JAZZ — a saxophonist. Valves work, bell flares.
 */
export function JazzIcon({ tone, ...p }: IconProps) {
  return (
    <Scene {...p}>
      <circle cx="10.4" cy="6.2" r="2.8" />
      <path d="M6.4 17v-2.6a4 4 0 0 1 4-4" />
      {/* sax body */}
      <path d="M13.4 8.2v8.6c0 4 1.8 6.6 5 7.9" />
      <path d="M18.4 24.7c3.1 1 5.8-.5 6.5-3.4" fill={tone} />
      <path d="M24.9 21.3c.6-2.4 2.4-2.9 2.9-1.2.6 2-.5 5.3-3.1 7-2.6 1.7-6 1.4-8.3-.2" />
      <path d="M13.4 9.9h2.8" />
      {/* valves */}
      <circle data-part="valve-1" cx="15.4" cy="13.6" r="1" fill="currentColor" stroke="none" />
      <circle data-part="valve-2" cx="15.9" cy="17.9" r="1" fill="currentColor" stroke="none" />
    </Scene>
  );
}

/**
 * ELECTRONIC — a producer at a synth, waveform on the display.
 */
export function ElectronicIcon({ tone, ...p }: IconProps) {
  return (
    <Scene {...p}>
      <circle cx="16" cy="6" r="2.8" />
      <path d="M11.6 15v-1.8a4.4 4.4 0 0 1 8.8 0V15" />
      <path data-part="arm-l" d="M11.8 13.6 9.4 17.4" />
      <path data-part="arm-r" d="M20.2 13.6 22.6 17.4" />
      {/* synth */}
      <rect x="3.6" y="17.8" width="24.8" height="9.6" rx="2" fill={tone} />
      {/* waveform display */}
      <path d="M7 22.6h1.7l1.5-3.4 1.9 6.8 1.9-5.1 1.5 3.4 1.3-1.7h2.2" />
      {/* knobs */}
      <circle cx="23" cy="21.4" r="1.5" />
      <circle cx="26" cy="21.4" r="1.5" />
      <path d="M22 25.4h5" opacity="0.55" />
    </Scene>
  );
}

/**
 * R&B — a vocalist at a mic stand, one hand raised. The mic ring pulses.
 */
export function RnBIcon({ tone, ...p }: IconProps) {
  return (
    <Scene {...p}>
      <circle cx="13" cy="6.4" r="2.9" />
      <path d="M8.6 18.4v-3.6a4.4 4.4 0 0 1 8.8 0v3.6" />
      <path data-part="arm-r" d="M17.2 15 21.6 9.4" />
      <path d="M10.4 18.6 9.4 28.4M15.6 18.6l1 9.8" />
      {/* mic */}
      <circle data-part="mic-ring" cx="23.4" cy="8" r="4.4" opacity="0.3" strokeWidth={1.2} />
      <rect x="21.8" y="4.6" width="3.2" height="6.4" rx="1.6" fill={tone} />
      <path d="M20.4 9.6a3 3 0 0 0 6 0" />
      <path d="M23.4 12.6v3.2" />
    </Scene>
  );
}

/**
 * AFROBEATS / percussion — a drummer over a djembe, stick mid-strike.
 */
export function AfroIcon({ tone, ...p }: IconProps) {
  return (
    <Scene {...p}>
      <circle cx="11.4" cy="5.8" r="2.7" />
      <path d="M7.6 14.6v-2.4a3.9 3.9 0 0 1 7.8 0" />
      <path data-part="stick" d="M15 12.4 21.6 8.2" />
      {/* drum */}
      <ellipse data-part="drum-skin" cx="15.8" cy="18.2" rx="7.4" ry="2.8" fill={tone} />
      <path d="M8.4 18.2c0 3.4 1.4 6.6 2.6 9.2h9.6c1.2-2.6 2.6-5.8 2.6-9.2" />
      <path d="M10.6 22.4h10.4" opacity="0.5" />
      <path d="M11.4 27.4l-1 1.8M20.2 27.4l1 1.8" opacity="0.6" />
    </Scene>
  );
}

/**
 * COUNTRY / FOLK — a fiddle player, bow drawn across.
 */
export function FolkIcon({ tone, ...p }: IconProps) {
  return (
    <Scene {...p}>
      <circle cx="10" cy="6" r="2.7" />
      <path d="M6.2 15.4v-2.6a3.8 3.8 0 0 1 7.6 0" />
      {/* violin body */}
      <path
        d="M20.4 26.4c2.8 0 4.7-2 4.7-4.5 0-1.9-1.4-2.9-1.4-4.5s1.4-2.4 1.4-4.2c0-2.3-1.9-4-4.7-4s-4.7 1.7-4.7 4c0 1.8 1.4 2.6 1.4 4.2s-1.4 2.6-1.4 4.5c0 2.5 1.9 4.5 4.7 4.5Z"
        fill={tone}
      />
      <path d="M20.4 9.2V6.2" />
      {/* bow */}
      <path data-part="stick" d="M12.4 14.4 28 20.6" />
      <path data-part="string-1" d="M18.8 17.6h3.2" opacity="0.6" strokeWidth={1} />
    </Scene>
  );
}

/**
 * REGGAE / DANCEHALL — a soundsystem stack with a dancing figure.
 */
export function ReggaeIcon({ tone, ...p }: IconProps) {
  return (
    <Scene {...p}>
      {/* speaker stack */}
      <rect x="3.4" y="6.4" width="12.2" height="22" rx="2" fill={tone} />
      <circle data-part="cup-l" cx="9.5" cy="12.4" r="3.2" />
      <circle data-part="cup-r" cx="9.5" cy="22.4" r="2.2" />
      {/* dancer */}
      <circle cx="23" cy="7.4" r="2.6" />
      <path data-part="arm-r" d="M23.2 11.4 27.6 8.4" />
      <path d="M20.6 18.6v-3.4a3.2 3.2 0 0 1 5.6-2.1" />
      <path d="M21 18.8 19.4 28.4M24.6 18.8l2 9.6" />
    </Scene>
  );
}

/**
 * LO-FI / AMBIENT — a cassette, reels turning.
 */
export function LoFiIcon({ tone, ...p }: IconProps) {
  return (
    <Scene {...p}>
      <rect x="2.8" y="7.4" width="26.4" height="17.2" rx="2.6" fill={tone} />
      <g data-part="disc">
        <circle cx="10.6" cy="15" r="3.4" />
        <path d="M10.6 11.6a3.4 3.4 0 0 1 2.8 1.5" opacity="0.5" />
      </g>
      <g data-part="platter">
        <circle cx="21.4" cy="15" r="3.4" />
        <path d="M21.4 11.6a3.4 3.4 0 0 1 2.8 1.5" opacity="0.5" />
      </g>
      <path d="M10.6 15h10.8" opacity="0.45" />
      <path d="M8.4 21.4h15.2" />
      <path d="M11 24.6l-1.4 3M21 24.6l1.4 3" opacity="0.6" />
    </Scene>
  );
}

/**
 * PODCAST / SPOKEN — a broadcast mic on a boom, waves radiating.
 */
export function PodcastIcon({ tone, ...p }: IconProps) {
  return (
    <Scene {...p}>
      <g data-part="wave-1">
        <path d="M8 9.4a8 8 0 0 0 0 11.2" opacity="0.55" />
      </g>
      <g data-part="wave-2">
        <path d="M24 20.6a8 8 0 0 0 0-11.2" opacity="0.55" />
      </g>
      <rect x="12.6" y="4.6" width="6.8" height="12.4" rx="3.4" fill={tone} />
      <path d="M14.4 8h3.2M14.4 11h3.2" opacity="0.55" strokeWidth={1.1} />
      <path d="M16 17.4v4" />
      <path d="M10.6 21.4h10.8a2 2 0 0 1 2 2v3.2a2 2 0 0 1-2 2H10.6a2 2 0 0 1-2-2v-3.2a2 2 0 0 1 2-2Z" />
      <path d="M12.6 25h6.8" opacity="0.6" />
    </Scene>
  );
}

/**
 * METAL / PUNK — a raised fist with an amp stack behind it.
 */
export function MetalIcon({ tone, ...p }: IconProps) {
  return (
    <Scene {...p}>
      <rect x="18.4" y="10.4" width="10.8" height="18" rx="1.8" fill={tone} />
      <circle cx="23.8" cy="16.4" r="2.8" />
      <path d="M20.6 24.4h6.4" opacity="0.55" />
      {/* fist */}
      <path data-part="flame" d="M6.4 28.4v-6.8a3 3 0 0 1 3-3h3.6a2.6 2.6 0 0 0 0-5.2h-.6" />
      <path d="M9.4 13.4V5.6a1.7 1.7 0 0 1 3.4 0v7.2" />
      <path d="M12.8 13.4V7.4a1.7 1.7 0 0 1 3.4 0v6.6" />
      <path d="M6.4 21.6 4.2 19a1.7 1.7 0 0 1 2.4-2.4l2 2" />
    </Scene>
  );
}

/**
 * LATIN — maracas mid-shake, crossed.
 */
export function LatinIcon({ tone, ...p }: IconProps) {
  return (
    <Scene {...p}>
      <g data-part="stick">
        <ellipse cx="10.4" cy="8.4" rx="4.4" ry="5" fill={tone} />
        <path d="M12.6 12.8 17.4 26.4" />
      </g>
      <g data-part="drum-skin">
        <ellipse cx="22.4" cy="10.4" rx="4" ry="4.6" />
        <path d="M20.6 14.6 16.4 26.4" />
      </g>
      <path d="M8.4 7.4h4M20.6 9.4h3.6" opacity="0.5" strokeWidth={1.1} />
    </Scene>
  );
}

/**
 * K-POP — a stage figure under a spotlight beam.
 */
export function KPopIcon({ tone, ...p }: IconProps) {
  return (
    <Scene {...p}>
      <path d="M16 2.6 6.4 19.4h19.2Z" fill={tone} opacity="0.25" stroke="none" />
      <path d="M11.4 12.4 16 4.8l4.6 7.6" opacity="0.5" strokeWidth={1.2} />
      <circle cx="16" cy="14.4" r="2.7" />
      <path data-part="arm-l" d="M13 18.4 9 16" />
      <path data-part="arm-r" d="M19 18.4 23 16" />
      <path d="M12.6 24v-3.2a3.4 3.4 0 0 1 6.8 0V24" />
      <path d="M13.4 24.2 12 29.4M18.6 24.2l1.4 5.2" />
    </Scene>
  );
}

/** GOSPEL / SOUL — a choir trio, mouths open, above an open book. */
export function GospelIcon({ tone, ...p }: IconProps) {
  return (
    <Scene {...p}>
      <circle cx="8.4" cy="7.4" r="2.4" />
      <circle data-part="head" cx="16" cy="5.8" r="2.7" />
      <circle cx="23.6" cy="7.4" r="2.4" />
      <path d="M4.8 16.4v-2.6a3.6 3.6 0 0 1 7.2 0v2.6" />
      <path d="M11.8 16.4v-3a4.2 4.2 0 0 1 8.4 0v3" />
      <path d="M20 16.4v-2.6a3.6 3.6 0 0 1 7.2 0v2.6" />
      <path d="M16 19.4c-3.4-1.9-7.4-1.9-11.2-.6v8.2c3.8-1.3 7.8-1.3 11.2.6Z" fill={tone} />
      <path d="M16 19.4c3.4-1.9 7.4-1.9 11.2-.6v8.2c-3.8-1.3-7.8-1.3-11.2.6Z" fill={tone} />
    </Scene>
  );
}

/** POP — a star performer with a headset mic and a boombox. */
export function PopIcon({ tone, ...p }: IconProps) {
  return (
    <Scene {...p}>
      <circle cx="12.4" cy="6.6" r="3" />
      <path d="M15.4 7.4a3.2 3.2 0 0 0 2.6-.4" opacity="0.7" strokeWidth={1.2} />
      <circle cx="18.6" cy="6.6" r="1" fill={tone || "currentColor"} stroke="none" />
      <path d="M7.6 17.4v-3.2a4.8 4.8 0 0 1 9.6 0v3.2" />
      <path data-part="arm-r" d="M17 14.6 21.6 11" />
      <g data-part="spark-1">
        <path d="M25 6.4l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9Z" />
      </g>
      <rect x="5.6" y="19.4" width="21" height="9" rx="2" fill={tone} />
      <circle data-part="cup-l" cx="11.4" cy="23.9" r="2.6" />
      <circle data-part="cup-r" cx="20.8" cy="23.9" r="2.6" />
    </Scene>
  );
}

/** HOUSE / EDM — a crowd of raised hands under a strobe. */
export function HouseIcon({ tone, ...p }: IconProps) {
  return (
    <Scene {...p}>
      <g data-part="spark-1">
        <path d="M16 2.4v3.4M9.6 4.4l1.6 2.8M22.4 4.4l-1.6 2.8" opacity="0.7" />
      </g>
      <rect x="12.6" y="7.4" width="6.8" height="4.4" rx="1.4" fill={tone} />
      <path d="M13.6 11.8 10.4 16M18.4 11.8 21.6 16" opacity="0.45" strokeWidth={1.2} />
      <path data-part="bar-1" d="M6.4 28.4V17.4a1.8 1.8 0 0 1 3.6 0v11" />
      <path data-part="bar-2" d="M11.8 28.4V14.6a1.8 1.8 0 0 1 3.6 0v13.8" />
      <path data-part="bar-3" d="M17.2 28.4V15.4a1.8 1.8 0 0 1 3.6 0v13" />
      <path data-part="bar-4" d="M22.6 28.4V18.4a1.8 1.8 0 0 1 3.6 0v10" />
    </Scene>
  );
}

/* ── Now-playing indicator ────────────────────────────────────────────────
 *
 * Not really an icon — a live state readout. Bars dance while playing and
 * freeze low when paused, so a track row shows *which* track is current and
 * whether it's running, without a second element.
 */
export function NowPlayingBars({
  size = 16,
  playing = true,
  className,
  style,
}: {
  size?: number;
  playing?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={`${styles.icon} ${styles.eqBars}${className ? ` ${className}` : ""}`}
      style={style}
      data-paused={!playing}
      aria-hidden="true"
      focusable="false"
      fill="currentColor"
    >
      <rect data-part="bar-1" x="1" y="4" width="2.6" height="11" rx="1.3" />
      <rect data-part="bar-2" x="5" y="1" width="2.6" height="14" rx="1.3" />
      <rect data-part="bar-3" x="9" y="3" width="2.6" height="12" rx="1.3" />
      <rect data-part="bar-4" x="13" y="6" width="2.6" height="9" rx="1.3" />
    </svg>
  );
}

/* ── Back-compat aliases ──────────────────────────────────────────────────
 * Names the old set exported that callers still import. Pointed at the
 * closest new glyph so no import breaks during the migration.
 */
export const MusicNotesIcon = MusicNoteIcon;
export const GuitarIcon = RockIcon;
export const SaxophoneIcon = JazzIcon;
export const ViolinIcon = FolkIcon;
export const SliderIcon = ElectronicIcon;
