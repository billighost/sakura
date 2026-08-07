import React from "react";

/**
 * Sakura's icon system.
 *
 * Design language, applied consistently so the set reads as one family:
 *
 *   - 24×24 optical grid, 2px stroke, round caps and joins.
 *   - Stroke-first. Fill is reserved for state ("this is liked", "this is
 *     playing"), which makes filled-ness meaningful rather than decorative.
 *   - `currentColor` throughout, so colour is the caller's business and every
 *     icon themes correctly in both palettes for free.
 *   - `strokeWidth` is a prop, because a 16px icon needs a heavier relative
 *     stroke than a 32px one to hold up optically.
 *
 * This replaces a set where GuitarIcon, SaxophoneIcon, ViolinIcon and
 * MusicNotesIcon were all literally the same Material music-note path — four
 * names, one glyph, so genre chips were visually indistinguishable.
 */

export interface IconProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  strokeWidth?: number;
  /** Solid variant, for active/selected states. */
  filled?: boolean;
  title?: string;
}

function Svg({
  size = 24,
  className,
  style,
  strokeWidth = 2,
  title,
  children,
  fill = "none",
}: IconProps & { children: React.ReactNode; fill?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
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

/* ── Transport ──────────────────────────────────────────────────────────── */

export function PlayIcon(p: IconProps) {
  return (
    <Svg {...p} fill="currentColor">
      <path d="M7.5 5.6v12.8a1 1 0 0 0 1.52.86l10.2-6.4a1 1 0 0 0 0-1.72L9.02 4.74A1 1 0 0 0 7.5 5.6Z" stroke="none" />
    </Svg>
  );
}

export function PauseIcon(p: IconProps) {
  return (
    <Svg {...p} fill="currentColor">
      <rect x="6.5" y="5" width="3.8" height="14" rx="1.6" stroke="none" />
      <rect x="13.7" y="5" width="3.8" height="14" rx="1.6" stroke="none" />
    </Svg>
  );
}

export function NextIcon(p: IconProps) {
  return (
    <Svg {...p} fill="currentColor">
      <path d="M5 6.4v11.2a1 1 0 0 0 1.53.85l8.8-5.6a1 1 0 0 0 0-1.7l-8.8-5.6A1 1 0 0 0 5 6.4Z" stroke="none" />
      <rect x="16.8" y="5" width="2.9" height="14" rx="1.45" stroke="none" />
    </Svg>
  );
}

export function PrevIcon(p: IconProps) {
  return (
    <Svg {...p} fill="currentColor">
      <path d="M19 6.4v11.2a1 1 0 0 1-1.53.85l-8.8-5.6a1 1 0 0 1 0-1.7l8.8-5.6A1 1 0 0 1 19 6.4Z" stroke="none" />
      <rect x="4.3" y="5" width="2.9" height="14" rx="1.45" stroke="none" />
    </Svg>
  );
}

export function ShuffleIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M16.5 3.5 20 7l-3.5 3.5" />
      <path d="M16.5 13.5 20 17l-3.5 3.5" />
      <path d="M20 7h-3.1c-1.9 0-3.6 1-4.6 2.6l-3.6 5.8c-1 1.6-2.7 2.6-4.6 2.6H4" />
      <path d="M4 7h1.1c1.9 0 3.6 1 4.6 2.6l.5.8" />
      <path d="M13.6 14.5l.7 1.1c1 1.6 2.7 2.6 4.6 2.6H20" />
    </Svg>
  );
}

export function RepeatIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M17 2.5 20.5 6 17 9.5" />
      <path d="M3.5 12.5V11a5 5 0 0 1 5-5h12" />
      <path d="M7 21.5 3.5 18 7 14.5" />
      <path d="M20.5 11.5V13a5 5 0 0 1-5 5h-12" />
    </Svg>
  );
}

export function RepeatOneIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M17 2.5 20.5 6 17 9.5" />
      <path d="M3.5 12.5V11a5 5 0 0 1 5-5h12" />
      <path d="M7 21.5 3.5 18 7 14.5" />
      <path d="M20.5 11.5V13a5 5 0 0 1-5 5h-12" />
      <path d="M11.2 10.4l1.3-.9V15" strokeWidth={1.7} />
    </Svg>
  );
}

/* ── State ──────────────────────────────────────────────────────────────── */

/**
 * A sakura petal rather than a generic heart — the like action is the app's
 * signature gesture and the petal burst animation already builds on this shape.
 */
export function HeartIcon({ filled, ...p }: IconProps) {
  return (
    <Svg {...p} fill={filled ? "currentColor" : "none"}>
      <path d="M12 20.6s-7.4-4.35-9.1-9.02a5.2 5.2 0 0 1 9.1-4.7 5.2 5.2 0 0 1 9.1 4.7C19.4 16.25 12 20.6 12 20.6Z" />
    </Svg>
  );
}

export function PetalIcon({ filled, ...p }: IconProps) {
  return (
    <Svg {...p} fill={filled ? "currentColor" : "none"}>
      <path d="M12 3c2.4 2.1 3.6 4.3 3.6 6.6 0 2-1.6 3.6-3.6 3.6s-3.6-1.6-3.6-3.6C8.4 7.3 9.6 5.1 12 3Z" />
      <path d="M12 13.2V21" />
      <path d="M12 16.5c-1.6-1.5-3.4-2.2-5.4-2.1" />
      <path d="M12 18.6c1.5-1.4 3.2-2 5-1.9" />
    </Svg>
  );
}

export function CheckIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4.5 12.8l4.6 4.6L19.5 7" />
    </Svg>
  );
}

export function CheckCircleIcon({ filled, ...p }: IconProps) {
  return (
    <Svg {...p} fill={filled ? "currentColor" : "none"}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.2 12.4l2.7 2.7 5-5.4" stroke={filled ? "var(--sakura-bg)" : "currentColor"} />
    </Svg>
  );
}

export function CloseIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  );
}

export function PlusIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

/* ── Navigation ─────────────────────────────────────────────────────────── */

export function HomeIcon({ filled, ...p }: IconProps) {
  return (
    <Svg {...p} fill={filled ? "currentColor" : "none"}>
      <path d="M3.5 10.4 12 3.6l8.5 6.8v8.3a1.7 1.7 0 0 1-1.7 1.7H5.2a1.7 1.7 0 0 1-1.7-1.7Z" />
      <path
        d="M9.4 20.4v-5.6a1.3 1.3 0 0 1 1.3-1.3h2.6a1.3 1.3 0 0 1 1.3 1.3v5.6"
        fill="none"
        stroke={filled ? "var(--sakura-bg)" : "currentColor"}
      />
    </Svg>
  );
}

export function SearchIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="10.8" cy="10.8" r="6.8" />
      <path d="M15.8 15.8 21 21" />
    </Svg>
  );
}

export function LibraryIcon({ filled, ...p }: IconProps) {
  return (
    <Svg {...p} fill={filled ? "currentColor" : "none"}>
      <rect x="3.2" y="4.5" width="3.6" height="15" rx="1.4" />
      <rect x="9" y="4.5" width="3.6" height="15" rx="1.4" />
      <path d="M16.4 6.2l2.6-.7a1.3 1.3 0 0 1 1.6.93l2.2 8.2" transform="translate(-1.6 0)" />
    </Svg>
  );
}

export function UserIcon({ filled, ...p }: IconProps) {
  return (
    <Svg {...p} fill={filled ? "currentColor" : "none"}>
      <circle cx="12" cy="8.2" r="4.2" />
      <path d="M4.4 20.2a7.6 7.6 0 0 1 15.2 0" />
    </Svg>
  );
}

export function ChevronDownIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5.5 9l6.5 6.5L18.5 9" />
    </Svg>
  );
}

export function ChevronRightIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9 5.5 15.5 12 9 18.5" />
    </Svg>
  );
}

export function ChevronLeftIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M15 5.5 8.5 12 15 18.5" />
    </Svg>
  );
}

export function MoreIcon(p: IconProps) {
  return (
    <Svg {...p} fill="currentColor">
      <circle cx="12" cy="5.2" r="1.9" stroke="none" />
      <circle cx="12" cy="12" r="1.9" stroke="none" />
      <circle cx="12" cy="18.8" r="1.9" stroke="none" />
    </Svg>
  );
}

/* ── Content types ──────────────────────────────────────────────────────── */

export function MusicNoteIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="7" cy="17.6" r="3.2" />
      <path d="M10.2 17.6V5.2l9.6-2.2v10.2" />
      <circle cx="16.6" cy="13.2" r="3.2" />
    </Svg>
  );
}

export function MusicNotesIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="5.6" cy="18.2" r="2.6" />
      <circle cx="16.2" cy="15.8" r="2.6" />
      <path d="M8.2 18.2V6.6l10.6-2.4v11.6" />
      <path d="M8.2 10.2 18.8 7.8" />
    </Svg>
  );
}

/** A record with a visible spindle and groove — reads as "album" at 16px. */
export function AlbumIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.4" />
      <circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none" />
      <path d="M12 3a9 9 0 0 1 7.4 3.9" opacity="0.45" />
    </Svg>
  );
}

export function DiscIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2.2" />
      <path d="M12 3a9 9 0 0 1 6.4 2.65" opacity="0.5" />
      <path d="M12 21a9 9 0 0 1-6.4-2.65" opacity="0.5" />
    </Svg>
  );
}

export function PlaylistIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.5 6.5h11M3.5 11.5h11M3.5 16.5h6.5" />
      <circle cx="17.4" cy="17.2" r="2.9" />
      <path d="M20.3 17.2V9l-4.6 1.2" />
    </Svg>
  );
}

export function QueueIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.5 6.5h12M3.5 11.5h12M3.5 16.5h7" />
      <circle cx="18" cy="16.9" r="2.7" />
      <path d="M20.7 16.9V8.4" />
    </Svg>
  );
}

export function MicrophoneIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="9" y="2.6" width="6" height="11.2" rx="3" />
      <path d="M5.4 11.4a6.6 6.6 0 0 0 13.2 0" />
      <path d="M12 18v3.4M8.8 21.4h6.4" />
    </Svg>
  );
}

export function HeadphonesIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.6 15.4v-3a8.4 8.4 0 0 1 16.8 0v3" />
      <rect x="2.6" y="14.4" width="4.6" height="6.4" rx="2.3" />
      <rect x="16.8" y="14.4" width="4.6" height="6.4" rx="2.3" />
    </Svg>
  );
}

/** Guitar: distinct double-bout body and neck. */
export function GuitarIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9.6 12.2c-2.1.6-3.4 2.3-3.4 4.3 0 2.4 1.9 4.1 4.3 4.1 1.6 0 2.9-.7 3.7-1.9.8-1.2 2.6-1.7 3.6-2.9" />
      <path d="M13.4 8.6c-1.5.9-2.9 2-3.8 3.6" />
      <path d="M17.8 15.8c1.2-1.4 1-3.4-.5-4.6-1.3-1-3-.9-4.2.1" />
      <path d="M15.2 9.4 20 4.2" />
      <path d="M18.6 2.8 21.4 5.6" />
      <circle cx="11" cy="16.2" r="1.6" />
    </Svg>
  );
}

/** Saxophone: curved bell and body, unmistakably not a music note. */
export function SaxophoneIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9.4 2.8v7.6c0 3.4 1.4 5.6 4 6.8" />
      <path d="M13.4 17.2c2.6.9 5-.4 5.6-2.8" />
      <path d="M19 14.4c.5-2 2-2.4 2.4-1 .5 1.7-.4 4.4-2.6 5.8-2.2 1.4-5 1.2-6.9-.2" />
      <path d="M9.4 4.4h2.4" />
      <circle cx="11.2" cy="8.4" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="11.6" cy="12" r="0.9" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** Violin: waisted body, neck, scroll and strings. */
export function ViolinIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 20.6c2.5 0 4.2-1.8 4.2-4 0-1.7-1.2-2.6-1.2-4s1.2-2.2 1.2-3.8c0-2-1.7-3.6-4.2-3.6S7.8 6.8 7.8 8.8c0 1.6 1.2 2.4 1.2 3.8s-1.2 2.3-1.2 4c0 2.2 1.7 4 4.2 4Z" />
      <path d="M12 5.2V2.6" />
      <path d="M10.2 2.4a1.8 1.8 0 1 0 3.6 0" />
      <path d="M10.6 12.2h2.8" />
    </Svg>
  );
}

/** Equalizer sliders — used for "mood"/"genre" chips. */
export function SliderIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 20V14M6 10V4M12 20v-8M12 8V4M18 20v-3M18 13V4" />
      <circle cx="6" cy="12" r="2" />
      <circle cx="12" cy="10" r="2" />
      <circle cx="18" cy="15" r="2" />
    </Svg>
  );
}

export function RadioIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="2.6" />
      <path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 16.2a6 6 0 0 0 0-8.4" />
      <path d="M4.9 4.9a10 10 0 0 0 0 14.2M19.1 19.1a10 10 0 0 0 0-14.2" opacity="0.6" />
    </Svg>
  );
}

/* ── Accents / feedback ─────────────────────────────────────────────────── */

export function SparklesIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3.2 13.7 8.3 18.8 10 13.7 11.7 12 16.8 10.3 11.7 5.2 10 10.3 8.3Z" />
      <path d="M18.4 15.4l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7Z" />
      <path d="M5.6 3l.5 1.5 1.5.5-1.5.5L5.6 7l-.5-1.5L3.6 5l1.5-.5Z" />
    </Svg>
  );
}

export function FireIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 21.2c3.5 0 6.2-2.5 6.2-6 0-4.4-4-6.5-4.9-11.4-2.2 1.6-3.6 3.9-3.6 6.1 0 1.3-.9 2-1.8 2-.9 0-1.5-.6-1.7-1.5-.9 1.4-1.4 3-1.4 4.8 0 3.5 2.7 6 7.2 6Z" />
      <path d="M12 21.2c1.8 0 3-1.2 3-2.9 0-2-1.9-2.8-2.4-5.2-1.4 1.1-2.4 2.5-2.4 4.1 0 2.2 1 4 1.8 4Z" opacity="0.55" />
    </Svg>
  );
}

export function LightningIcon({ filled, ...p }: IconProps) {
  return (
    <Svg {...p} fill={filled ? "currentColor" : "none"}>
      <path d="M13.2 2.4 4.8 13.2h5.6l-.8 8.4 8.6-11h-5.8Z" />
    </Svg>
  );
}

export function CloudIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M7 18.4h10.2a4 4 0 0 0 .5-8 6 6 0 0 0-11.4-1.3A3.9 3.9 0 0 0 7 18.4Z" />
    </Svg>
  );
}

export function PhoneIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="6.4" y="2.4" width="11.2" height="19.2" rx="2.6" />
      <path d="M10.4 5.4h3.2" />
      <path d="M12 18.4h.01" />
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

/* ── Actions ────────────────────────────────────────────────────────────── */

export function DownloadIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3.4v11.4" />
      <path d="M7.6 10.6 12 15l4.4-4.4" />
      <path d="M4.2 17.4v1.6a2 2 0 0 0 2 2h11.6a2 2 0 0 0 2-2v-1.6" />
    </Svg>
  );
}

export function DownloadedIcon(p: IconProps) {
  return (
    <Svg {...p} fill="currentColor">
      <circle cx="12" cy="12" r="9" stroke="none" />
      <path d="M8.2 12.3l2.6 2.6 5-5.4" stroke="var(--sakura-bg)" fill="none" strokeWidth={2.2} />
    </Svg>
  );
}

export function ShareIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 15.4V3.6" />
      <path d="M8.2 7.4 12 3.6l3.8 3.8" />
      <path d="M6 11.4H5.4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h13.2a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H18" />
    </Svg>
  );
}

export function TimerIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="13.4" r="8.2" />
      <path d="M12 9v4.4l2.8 1.8" />
      <path d="M9.2 2.4h5.6" />
      <path d="M12 2.4v2.8" />
    </Svg>
  );
}

export function VolumeIcon({ level = 1, ...p }: IconProps & { level?: number }) {
  return (
    <Svg {...p}>
      <path d="M11 4.6 6.4 8.6H3.2v6.8h3.2L11 19.4Z" />
      {level > 0.02 && <path d="M14.6 9.4a3.6 3.6 0 0 1 0 5.2" />}
      {level > 0.5 && <path d="M17.4 6.4a7.6 7.6 0 0 1 0 11.2" />}
      {level <= 0.02 && <path d="M15.4 9.6 20.4 14.6M20.4 9.6l-5 5" />}
    </Svg>
  );
}

export function TrashIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.8 6.4h16.4" />
      <path d="M8.4 6.4V4.6a1.6 1.6 0 0 1 1.6-1.6h4a1.6 1.6 0 0 1 1.6 1.6v1.8" />
      <path d="M5.8 6.4l.9 13a1.8 1.8 0 0 0 1.8 1.6h7a1.8 1.8 0 0 0 1.8-1.6l.9-13" />
      <path d="M10.4 10.6v6M13.6 10.6v6" />
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
      <path d="M3.4 8.2V6.4a2 2 0 0 1 2-2h3.4l2.2 2.6h7.6a2 2 0 0 1 2 2v9.6a2 2 0 0 1-2 2H5.4a2 2 0 0 1-2-2Z" />
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
      <path d="M12 19.4h.01" />
    </Svg>
  );
}

export function WifiIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.4 8.4a14 14 0 0 1 17.2 0" />
      <path d="M6.6 11.8a9.4 9.4 0 0 1 10.8 0" />
      <path d="M9.8 15.2a4.6 4.6 0 0 1 4.4 0" />
      <path d="M12 19h.01" />
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
      <circle cx="8.6" cy="9.6" r="1.8" />
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

export function SettingsIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.2 14.6a1.6 1.6 0 0 0 .32 1.76l.06.06a1.9 1.9 0 1 1-2.7 2.7l-.06-.06a1.6 1.6 0 0 0-1.76-.32 1.6 1.6 0 0 0-1 1.46v.18a1.9 1.9 0 1 1-3.8 0v-.1a1.6 1.6 0 0 0-1.05-1.46 1.6 1.6 0 0 0-1.76.32l-.06.06a1.9 1.9 0 1 1-2.7-2.7l.06-.06a1.6 1.6 0 0 0 .32-1.76 1.6 1.6 0 0 0-1.46-1H3.4a1.9 1.9 0 1 1 0-3.8h.1a1.6 1.6 0 0 0 1.46-1.05 1.6 1.6 0 0 0-.32-1.76l-.06-.06a1.9 1.9 0 1 1 2.7-2.7l.06.06a1.6 1.6 0 0 0 1.76.32h.08a1.6 1.6 0 0 0 1-1.46V3.4a1.9 1.9 0 1 1 3.8 0v.1a1.6 1.6 0 0 0 1 1.46 1.6 1.6 0 0 0 1.76-.32l.06-.06a1.9 1.9 0 1 1 2.7 2.7l-.06.06a1.6 1.6 0 0 0-.32 1.76v.08a1.6 1.6 0 0 0 1.46 1h.18a1.9 1.9 0 1 1 0 3.8h-.1a1.6 1.6 0 0 0-1.46 1Z" />
    </Svg>
  );
}

/* ── Brand ──────────────────────────────────────────────────────────────── */

/** Five-petal cherry blossom. The one place we use fill by default. */
export function SakuraIcon({ size = 24, className, style, title }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      style={style}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {[0, 72, 144, 216, 288].map((deg) => (
        <path
          key={deg}
          d="M12 12c-1.9-1.1-3-2.9-3-4.8 0-1.8 1.3-3.2 3-3.2s3 1.4 3 3.2c0 1.9-1.1 3.7-3 4.8Z"
          transform={`rotate(${deg} 12 12)`}
        />
      ))}
      <circle cx="12" cy="12" r="1.7" fill="var(--sakura-bg, #0E0B0F)" />
    </svg>
  );
}

/* ── Genre glyphs ───────────────────────────────────────────────────────────
 *
 * One distinct silhouette per genre. These exist because the search page's
 * category chips previously drew Guitar/Saxophone/Violin/MusicNotes from four
 * names that all pointed at the *same* Material note path — eight chips, three
 * distinguishable shapes between them.
 *
 * Each one is built from a different primitive (body outline, waveform, stack,
 * keyboard) so they stay separable at the 24px they render at.
 */

/** Electric guitar: offset double-cutaway body, angled neck, tuning pegs. */
export function RockIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8.8 13c-2 .7-3.2 2.4-3.2 4.3 0 2.3 1.8 3.9 4.1 3.9 1.6 0 2.8-.7 3.6-1.9.7-1.1 2.4-1.7 3.4-2.8" />
      <path d="M17 15.7c1.1-1.4.9-3.3-.6-4.4-1.3-.9-3-.8-4.1.2" />
      <path d="M14.6 9.6 19.4 4.4" />
      <path d="M18 3 20.8 5.8" />
      <path d="M19.9 2.2l1.9 1.9" />
      <circle cx="10.4" cy="17" r="1.5" />
    </Svg>
  );
}

/** Turntable: platter, tonearm, spindle — reads as hip-hop/DJ, not a note. */
export function HipHopIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="11" cy="13.4" r="7.4" />
      <circle cx="11" cy="13.4" r="1.5" />
      <path d="M18.6 4.6 14.6 9.4" />
      <circle cx="19.2" cy="4" r="1.4" />
    </Svg>
  );
}

/** Waveform in a frame — synthesised sound rather than an instrument. */
export function ElectronicIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="2.6" y="5.4" width="18.8" height="13.2" rx="2.6" />
      <path d="M6 12h1.6l1.4-3.2 1.8 6.4 1.8-4.8 1.4 3.2 1.2-1.6H18" />
    </Svg>
  );
}

/** Vinyl heart — R&B/soul. */
export function RnBIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 20.4s-6.8-4-8.4-8.3A4.8 4.8 0 0 1 12 7.7a4.8 4.8 0 0 1 8.4 4.4c-1.6 4.3-8.4 8.3-8.4 8.3Z" />
      <circle cx="12" cy="12.4" r="2" />
      <circle cx="12" cy="12.4" r="0.5" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** Saxophone: mouthpiece, keyed body, flared bell. */
export function JazzIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9.6 2.8v7.8c0 3.3 1.4 5.5 4 6.6" />
      <path d="M13.6 17.2c2.5.9 4.8-.4 5.4-2.8" />
      <path d="M19 14.4c.5-2 2-2.4 2.4-1 .5 1.7-.4 4.4-2.6 5.8-2.2 1.4-5 1.2-6.9-.2" />
      <path d="M9.6 4.2h2.2" />
      <circle cx="11.3" cy="8.2" r="0.85" fill="currentColor" stroke="none" />
      <circle cx="11.7" cy="11.8" r="0.85" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** Piano keys — the clearest classical shorthand at small sizes. */
export function ClassicalIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="2.8" y="6" width="18.4" height="12" rx="2" />
      <path d="M8.4 6v7.4M13.2 6v7.4M18 6v7.4" />
      <path d="M2.8 13.4h18.4" />
    </Svg>
  );
}

/** Microphone on a boom arm — a podcast, distinct from the vocal mic. */
export function PodcastIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="8.6" y="2.6" width="6.8" height="9.4" rx="3.4" />
      <path d="M12 12v3.2" />
      <path d="M7.4 15.2h9.2a1.8 1.8 0 0 1 1.8 1.8v2.6a1.8 1.8 0 0 1-1.8 1.8H7.4a1.8 1.8 0 0 1-1.8-1.8V17a1.8 1.8 0 0 1 1.8-1.8Z" />
      <path d="M9.4 18.4h5.2" />
    </Svg>
  );
}
