/* eslint-disable @next/next/no-img-element -- ImageResponse renders native images into PNGs. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import type { CSSProperties, ReactElement } from "react";
import { sakuraPetalPath, sakuraPetalVeins } from "../app/Brand";
import { OG_SIZE, type OgDirection, type OgPreviewPage } from "./catalog";
import fontMetrics from "./font-metrics.json";
import fallbackManifest from "../../../public/og-preview/fonts/fallbacks.json";

const colors = { paper: "#f5f5ee", white: "#fcfcf5", ink: "#273b34", green: "#446b57", muted: "#637367", petal: "#d5ada8", night: "#15291f", moon: "#eceddf", sage: "#bbccb3", pink: "#e1beb7" };
const absolute: CSSProperties = { position: "absolute", display: "flex" };
const fontDefinitions = [
  { name: "Fraunces", file: "fraunces-600-normal.ttf", weight: 600, style: "normal" },
  { name: "Fraunces", file: "fraunces-600-italic.ttf", weight: 600, style: "italic" },
  { name: "Inter", file: "inter-400-normal.ttf", weight: 400, style: "normal" },
  { name: "Inter", file: "inter-600-normal.ttf", weight: 600, style: "normal" },
] as const;
const artworkFiles = ["ayra-portrait.jpg", "ayra-album.jpg", "rema-album.jpg", "burna-album.jpg", "bloom-light.jpg", "bloom-dark.jpg"];

export async function prepareOgArtwork(bytes: Uint8Array, withFlower = true) {
  const jpeg = await sharp(bytes, { limitInputPixels: 24_000_000, failOn: "error", animated: false }).rotate().resize(800, 800, { fit: "cover", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
  const normal = "data:image/jpeg;base64," + jpeg.toString("base64");
  if (!withFlower) return { normal, flower: undefined };
  const petals = [0, 72, 144, 216, 288].map(angle => `<path d="${sakuraPetalPath}" transform="rotate(${angle})" fill="white"/>`).join("");
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 100 100"><g transform="translate(50 50) scale(1.08)">${petals}</g></svg>`);
  const flower = await sharp(jpeg).resize(800, 800, { fit: "cover" }).ensureAlpha().composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
  return { normal, flower: "data:image/png;base64," + flower.toString("base64") };
}

const fontsPromise = Promise.all(fontDefinitions.map(async font => ({ name: font.name, weight: font.weight, style: font.style, data: await readFile(join(process.cwd(), "public/og-preview/fonts", font.file)) })));
const fixedArtwork = new Map<string, ReturnType<typeof prepareOgArtwork>>();
const fallbackFonts = new Map<string, Promise<Buffer>>();
async function fontsForText(text: string) {
  const baseCoverage: Record<string, number> = fontMetrics.normal;
  const points = [...new Set([...text].filter(character => baseCoverage[character] === undefined).map(character => character.codePointAt(0)!))];
  const selected = fallbackManifest.fonts.filter(font => font.ranges.some(([start, end]) => points.some(point => point >= start && point <= end)));
  const extras = await Promise.all(selected.map(async font => {
    let data = fallbackFonts.get(font.file);
    if (!data) {
      if (fallbackFonts.size >= 32) fallbackFonts.delete(fallbackFonts.keys().next().value!);
      data = readFile(join(process.cwd(), "public/og-preview/fonts", font.file));
      fallbackFonts.set(font.file, data);
    }
    return { name: font.name, weight: 400 as const, style: "normal" as const, data: await data };
  }));
  return [...await fontsPromise, ...extras];
}
async function localArtworkFor(page: OgPreviewPage) {
  const files = [...new Set([page.artwork, page.darkArtwork, ...(page.collage || [])])].filter((source): source is string => Boolean(source && artworkFiles.some(file => source === "/og-preview/artwork/" + file)));
  const entries = await Promise.all(files.map(async source => {
    let pending = fixedArtwork.get(source);
    if (!pending) {
      pending = prepareOgArtwork(await readFile(join(process.cwd(), "public", source)));
      fixedArtwork.set(source, pending);
    }
    const image = await pending;
    return [[source, image.normal], [source + "#flower", image.flower!]];
  }));
  return Object.fromEntries(entries.flat()) as Record<string, string>;
}

function flowerShape({ color, paper, outline = false }: { color: string; paper: string; outline?: boolean }) {
  return <g transform="translate(50 50) scale(.96)">
    {[0, 72, 144, 216, 288].map(angle => <g key={angle} transform={`rotate(${angle})`}>
      <path d={sakuraPetalPath} fill={outline ? "none" : color} stroke={outline ? color : "none"} strokeWidth=".6" />
      {!outline && <><path d="M0 4C-7-1-21-10-23-24C-25-34-18-42-9-42C-16-33-12-14 0 4Z" fill={paper} opacity=".16" />
        <path d={sakuraPetalVeins} fill="none" stroke={paper} strokeWidth=".7" strokeLinecap="round" opacity=".6" /></>}
    </g>)}
    <circle r="6.7" fill={outline ? "none" : paper} stroke={color} strokeWidth=".5" />
    {Array.from({ length: 10 }, (_, index) => <g key={index} transform={`rotate(${index * 36})`} stroke={paper} strokeWidth=".7">
      <path d="M0-2 0-12" /><circle cy="-12" r="1.1" fill={paper} />
    </g>)}
    <circle r="2.2" fill={color} />
  </g>;
}

function Mark({ size, color = colors.green, paper = colors.paper, style }: { size: number; color?: string; paper?: string; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 100 100" style={style}>{flowerShape({ color, paper })}</svg>;
}

function Grain({ dark = false }: { dark?: boolean }) {
  return <svg width="1200" height="630" viewBox="0 0 1200 630" style={{ ...absolute, left: 0, top: 0, opacity: dark ? .075 : .1 }}>
    <defs><pattern id="paper-grain" width="72" height="64" patternUnits="userSpaceOnUse">
      {Array.from({ length: 30 }, (_, index) => <circle key={index} cx={(index * 23 + 3) % 72} cy={(index * 17 + 11) % 64} r={index % 4 === 0 ? .65 : .35} fill={dark ? colors.moon : colors.ink} opacity={index % 3 === 0 ? .7 : .4} />)}
      <path d="M3 52h3M48 17h2M34 36h1" stroke={dark ? colors.moon : colors.ink} strokeWidth=".35" opacity=".3" />
    </pattern></defs><rect width="1200" height="630" fill="url(#paper-grain)" />
  </svg>;
}

const branchFlowers = [[359, 95, .75, -12], [448, 167, .52, 19], [265, 177, .57, -15], [392, 279, .74, 14], [505, 332, .55, -7], [273, 362, .49, 20], [470, 84, .3, 10], [334, 246, .32, -11], [194, 262, .36, 5], [521, 229, .38, 15], [372, 409, .25, -8]];
function Botanical({ left, top, width = 520, height = 470, dark = false, opacity = 1, outline = false }: { left: number; top: number; width?: number; height?: number; dark?: boolean; opacity?: number; outline?: boolean }) {
  const ink = dark ? colors.sage : colors.green;
  const petal = dark ? "#caaba5" : colors.petal;
  return <svg width={width} height={height} viewBox="0 0 600 540" style={{ ...absolute, left, top, opacity }}>
    <g fill="none" stroke={ink} strokeLinecap="round">
      <path d="M397 563C354 479 377 403 403 334C437 244 405 150 359 95M399 344C433 361 475 356 505 332M404 301C356 247 303 207 265 177M382 419C343 410 300 394 273 362M401 228C436 223 481 235 521 229" strokeWidth="1.7" />
      <path d="M403 334Q381 302 334 246M305 215Q263 271 194 262M406 247Q440 210 448 167M383 447Q389 420 372 409M422 250Q442 169 470 84M395 500Q366 476 339 472" strokeWidth=".85" />
      <path d="M364 111Q385 104 389 85M373 365Q345 336 322 333M499 334Q523 326 538 298" strokeWidth=".55" opacity=".65" />
    </g>
    {branchFlowers.map(([x, y, scale, angle], index) => <g key={index} transform={`translate(${x - 50 * scale} ${y - 50 * scale}) rotate(${angle} ${50 * scale} ${50 * scale}) scale(${scale})`}>{flowerShape({ color: petal, paper: dark ? colors.night : colors.paper, outline })}</g>)}
    <g fill={petal} opacity=".85"><path d="M114 383Q96 354 115 340Q129 363 114 383M492 442Q481 415 495 406Q508 427 492 442M190 105Q180 81 194 74Q205 90 190 105M552 157Q541 128 558 119Q571 142 552 157" /></g>
    <g fill={ink} opacity=".45"><path d="M339 472Q314 474 304 453Q329 452 339 472M538 298Q537 278 555 271Q551 290 538 298" /></g>
  </svg>;
}

function Petals({ dark = false }: { dark?: boolean }) {
  return <svg width="1200" height="630" style={{ ...absolute, left: 0, top: 0 }} viewBox="0 0 1200 630">
    <g fill={dark ? "#d4b1a6" : colors.petal} opacity={dark ? .7 : .65}>
      <path d="M682 114Q663 98 674 86Q693 85 682 114M1104 523Q1083 504 1095 491Q1116 497 1104 523M695 473Q679 457 689 447Q707 454 695 473M1021 70Q1008 53 1016 43Q1034 50 1021 70" />
    </g>
    {dark && <g fill={colors.sage} opacity=".7"><circle cx="731" cy="155" r="1.6" /><circle cx="1059" cy="101" r="1.4" /><circle cx="1118" cy="403" r="1.8" /><path d="M701 364h10m-5-5v10M1060 451h8m-4-4v8" stroke={colors.sage} strokeWidth="1" /></g>}
  </svg>;
}

function Brand({ dark = false, left = 64, top = 48, small = false }: { dark?: boolean; left?: number; top?: number; small?: boolean }) {
  return <div style={{ ...absolute, left, top, gap: 13, alignItems: "center", color: dark ? colors.moon : colors.ink }}>
    <Mark size={small ? 33 : 45} color={dark ? colors.sage : colors.green} paper={dark ? colors.night : colors.paper} />
    <div style={{ display: "flex", fontFamily: "Fraunces", fontWeight: 600, fontSize: small ? 30 : 40, letterSpacing: -1.7, paddingBottom: 4 }}>sakura</div>
  </div>;
}

function Arrow({ color, play = false }: { color: string; play?: boolean }) {
  return <svg width="19" height="19" viewBox="0 0 24 24">{play ? <path d="m8 5 11 7-11 7Z" fill={color} /> : <path d="M5 18 18 5M6 5h12v12" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />}</svg>;
}

function Footer({ page, dark = false, press = false }: { page: OgPreviewPage; dark?: boolean; press?: boolean }) {
  const ink = press || dark ? colors.moon : colors.green;
  return <>
    {!press && <div style={{ ...absolute, left: 64, top: 552, width: 1072, height: 1, background: dark ? "#385243" : "#d5ddd0" }} />}
    {press && <div style={{ ...absolute, left: 0, top: 557, width: 1200, height: 73, background: colors.ink }} />}
    <div style={{ ...absolute, left: 64, top: press ? 574 : 572, width: 1072, alignItems: "center", justifyContent: "space-between", color: ink }}>
      {press ? <div style={{ display: "flex", alignItems: "center", gap: 10 }}><Mark size={28} color={colors.petal} paper={colors.ink} /><div style={{ display: "flex", fontFamily: "Fraunces", fontWeight: 600, fontSize: 29, letterSpacing: -.9 }}>sakura</div><div style={{ display: "flex", marginLeft: 17, color: "#bdcbb8", fontSize: 12, letterSpacing: 1.5 }}>YOUR LITTLE MUSIC WORLD</div></div> : <div style={{ display: "flex", gap: 9, alignItems: "center", fontSize: 12, letterSpacing: 2, fontWeight: 600 }}><svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 0v12M0 6h12M2 2l8 8M2 10l8-8" stroke={dark ? colors.petal : colors.green} strokeWidth=".8" /></svg>YOUR LITTLE MUSIC WORLD</div>}
      <div style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 16, fontWeight: 400 }}><div style={{ display: "flex" }}>{page.action}</div><Arrow color={ink} play={page.kind === "track" || page.kind === "album" || page.kind === "artist"} /></div>
    </div>
  </>;
}

const graphemeSegmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
const wordSegmenter = new Intl.Segmenter("en", { granularity: "word" });
const graphemes = (text: string) => [...graphemeSegmenter.segment(text)].map(part => part.segment);
function textFontFamily(text: string, base: string) {
  const arabic = [...text].find(character => /\p{Script=Arabic}/u.test(character))?.codePointAt(0);
  if (arabic === undefined) return base;
  const font = fallbackManifest.fonts.find(font => font.name.includes("Arabic") && font.ranges.some(([start, end]) => arabic >= start && arabic <= end));
  return font ? font.name + ", " + base : base;
}
function textWidth(text: string, size: number, face: "normal" | "italic" | "sans", spacing: number) {
  const advances: Record<string, number> = fontMetrics[face];
  const glyphs = graphemes(text);
  const units = glyphs.reduce((total, glyph) => total + (/\p{Extended_Pictographic}/u.test(glyph) ? 1.1 : [...glyph].reduce((sum, character) => sum + (advances[character] ?? (/\p{Mark}/u.test(character) ? 0 : /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\uFF00-\uFFEF]/u.test(character) ? 1 : .62)), 0)), 0);
  return units * size + Math.max(0, glyphs.length - 1) * spacing;
}
function wrapText(text: string, size: number, width: number, face: "normal" | "italic" | "sans", spacing: number) {
  const rows: string[] = [];
  for (const line of text.split("\n")) {
    let current = "";
    for (const { segment } of wordSegmenter.segment(line)) {
      if (!current && !segment.trim()) continue;
      if (textWidth(current + segment, size, face, spacing) <= width - 12) { current += segment; continue; }
      if (current.trim()) { rows.push(current.trim()); current = ""; }
      for (const glyph of graphemes(segment.trimStart())) {
        if (current && textWidth(current + glyph, size, face, spacing) > width - 12) { rows.push(current.trim()); current = ""; }
        current += glyph;
      }
    }
    if (current.trim()) rows.push(current.trim());
  }
  return rows.length ? rows : [""];
}
function clipRows(rows: string[], maximum: number, size: number, width: number, face: "normal" | "italic" | "sans", spacing: number) {
  if (rows.length <= maximum) return rows;
  const fitted = rows.slice(0, maximum);
  const last = graphemes(fitted[maximum - 1]);
  while (last.length && textWidth(last.join("") + "…", size, face, spacing) > width - 12) last.pop();
  fitted[maximum - 1] = last.join("").trimEnd() + "…";
  return fitted;
}
function Title({ title, left, top, width, size = 96, color = colors.ink, italic = false, height = 206 }: { title: string; left: number; top: number; width: number; size?: number; color?: string; italic?: boolean; height?: number }) {
  const face = italic ? "italic" : "normal";
  let fontSize = title.includes("\n") ? Math.min(size, 91) : size;
  let rows = wrapText(title, fontSize, width, face, -3.2);
  while (fontSize > 32 && rows.length * fontSize * 1.06 > height - 6) { fontSize--; rows = wrapText(title, fontSize, width, face, -3.2); }
  rows = clipRows(rows, Math.max(1, Math.floor((height - 6) / (fontSize * 1.06))), fontSize, width, face, -3.2);
  return <div style={{ ...absolute, left, top, width, height, flexDirection: "column", justifyContent: "center", fontFamily: textFontFamily(title, "Fraunces"), fontWeight: 600, fontStyle: italic ? "italic" : "normal", fontSize, lineHeight: 1.03, letterSpacing: -3.2, color }}>
    {rows.map((line, index) => <div key={index} style={{ display: "flex", width, flexShrink: 0 }}>{line}</div>)}
  </div>;
}
function Eyebrow({ text, left = 64, top = 181, dark = false, width }: { text: string; left?: number; top?: number; dark?: boolean; width?: number }) {
  return <div style={{ ...absolute, left, top, ...(width === undefined ? {} : { width }), gap: 10, alignItems: "center", fontSize: 13, fontWeight: 600, letterSpacing: 2.7, color: dark ? colors.petal : colors.green }}>
    <div style={{ display: "flex", width: 21, height: 1, background: dark ? colors.petal : colors.green }} /><div style={{ display: "flex" }}>{text}</div>
  </div>;
}
function Caption({ page, left = 64, width = 620, dark = false, top = 444, detailTop = 507 }: { page: OgPreviewPage; left?: number; width?: number; dark?: boolean; top?: number; detailTop?: number }) {
  const subtitle = clipRows(wrapText(page.subtitle, 23, width, "sans", 0), 2, 23, width, "sans", 0);
  const detail = clipRows(wrapText(page.detail, 14, width, "sans", .2), 2, 14, width, "sans", .2);
  return <>
    <div style={{ ...absolute, left, top, width, flexDirection: "column", fontFamily: textFontFamily(page.subtitle, "Inter"), fontSize: 23, lineHeight: 1.3, color: dark ? colors.moon : colors.ink }}>{subtitle.map((line, index) => <div key={index} style={{ display: "flex", flexShrink: 0 }}>{line}</div>)}</div>
    <div style={{ ...absolute, left, top: detailTop, width, flexDirection: "column", fontFamily: textFontFamily(page.detail, "Inter"), fontSize: 14, lineHeight: 1.3, letterSpacing: .2, color: dark ? colors.sage : colors.muted }}>{detail.map((line, index) => <div key={index} style={{ display: "flex", flexShrink: 0 }}>{line}</div>)}</div>
  </>;
}

function Vinyl({ left, top, size, dark = false, rose = false, label = true, style }: { left: number; top: number; size: number; dark?: boolean; rose?: boolean; label?: boolean; style?: CSSProperties }) {
  const background = rose ? "#c09891" : dark ? "#213b2c" : "#1d2923";
  const line = rose ? "#e8c8c0" : dark ? "#526a50" : "#566253";
  return <div style={{ ...absolute, left, top, width: size, height: size, borderRadius: "50%", background: `radial-gradient(circle at 34% 24%, ${rose ? "#e2bdb3" : dark ? "#476248" : "#536151"} 0%, ${background} 48%, ${rose ? "#a97870" : "#0f1f16"} 100%)`, boxShadow: dark ? "0 18px 50px #0b1b16" : "0 15px 35px #273b3420", ...style }}>
    {[.97, .89, .83, .76, .69, .62, .55, .49, .41].map((ratio, index) => <div key={ratio} style={{ ...absolute, left: size * (1 - ratio) / 2, top: size * (1 - ratio) / 2, width: size * ratio, height: size * ratio, border: `1px solid ${line}`, borderRadius: "50%", opacity: index % 2 === 0 ? .55 : .27 }} />)}
    {label && <div style={{ ...absolute, left: size * .35, top: size * .35, width: size * .3, height: size * .3, alignItems: "center", justifyContent: "center", borderRadius: "50%", background: rose ? colors.paper : colors.petal, border: `1px solid ${rose ? "#eed0c7" : "#dab8ae"}` }}><Mark size={size * .19} color={colors.ink} paper={rose ? colors.paper : colors.petal} /><div style={{ ...absolute, left: size * .146, top: size * .146, width: size * .008, height: size * .008, borderRadius: "50%", background: colors.ink }} /></div>}
  </div>;
}
function BrandPlanet({ dark = false, press = false }: { dark?: boolean; press?: boolean }) {
  const ink = dark ? colors.sage : colors.green;
  return <>
    <div style={{ ...absolute, left: press ? 821 : 755, top: press ? 132 : 128, width: 377, height: 377, borderRadius: "50%", border: `1px solid ${dark ? "#4c654e" : press ? "#ba9790" : "#d8dfd0"}`, background: dark ? "radial-gradient(circle at 42% 36%, #456046 0%, #213b2c 58%, #172d22 100%)" : press ? "#d8afa8" : "radial-gradient(circle at 36% 30%, #fbfbf2 0%, #e6eadb 75%, #dbe3d2 100%)" }} />
    <svg width="530" height="460" viewBox="0 0 530 460" style={{ ...absolute, left: press ? 742 : 671, top: 91, opacity: dark ? .58 : .65 }}><ellipse cx="272" cy="244" rx="250" ry="128" transform="rotate(-33 272 244)" fill="none" stroke={ink} strokeWidth=".75" /><ellipse cx="272" cy="244" rx="240" ry="194" transform="rotate(28 272 244)" fill="none" stroke={ink} strokeWidth=".4" strokeDasharray="2 7" /></svg>
    <Mark size={press ? 302 : 237} color={press ? colors.ink : colors.petal} paper={press ? colors.pink : dark ? "#20392b" : colors.paper} style={{ ...absolute, left: press ? 859 : 824, top: press ? 170 : 193, transform: "rotate(-12deg)" }} />
    <Botanical left={press ? 751 : 638} top={108} width={590} height={468} dark={dark} opacity={press ? .52 : .85} outline={press} />
  </>;
}
function GeneratedCover({ size, dark = false, mix = false }: { size: number; dark?: boolean; mix?: boolean }) {
  return <div style={{ display: "flex", position: "relative", width: size, height: size, flexShrink: 0, alignItems: "center", justifyContent: "center", overflow: "hidden", background: dark ? "#314c38" : mix ? "#5d785d" : "#e1e7d7", color: dark || mix ? colors.moon : colors.ink }}>
    <svg width={size} height={size} viewBox="0 0 400 400" style={{ ...absolute, left: 0, top: 0 }}><circle cx="300" cy="89" r="164" fill={dark || mix ? "#95aa87" : "#d5ada8"} opacity=".42" /><path d="M-20 315Q100 192 228 280T435 198V420H-20Z" fill={dark || mix ? "#1f382b" : "#b9cbb0"} /><path d="M-20 354Q119 291 220 338T420 273" fill="none" stroke={colors.paper} strokeWidth="1" opacity=".55" /><ellipse cx="213" cy="197" rx="166" ry="111" transform="rotate(-30 213 197)" fill="none" stroke={colors.paper} strokeWidth=".7" opacity=".55" /></svg>
    <Mark size={size * .42} color={dark || mix ? colors.petal : colors.green} paper={dark || mix ? "#4a694e" : "#dfe5d6"} style={{ position: "absolute", top: size * .23, left: size * .3 }} />
    <div style={{ ...absolute, left: 0, top: size * .76, width: size, justifyContent: "center", fontFamily: "Fraunces", fontWeight: 600, fontSize: size * .1, letterSpacing: -1 }}>{mix ? "sakura mix" : "sakura"}</div>
  </div>;
}
function Cover({ source, artwork, size, style, dark = false, mix = false }: { source?: string; artwork: Record<string, string>; size: number; style?: CSSProperties; dark?: boolean; mix?: boolean }) {
  const image = source && artwork[source];
  return <div style={{ display: "flex", width: size, height: size, overflow: "hidden", flexShrink: 0, ...style }}>
    {image ? <img src={image} width={size} height={size} style={{ objectFit: "cover" }} alt="" /> : <GeneratedCover size={size} dark={dark} mix={mix} />}
  </div>;
}
function Mosaic({ page, artwork, left, top, size, rotate = 0, dark = false, press = false }: { page: OgPreviewPage; artwork: Record<string, string>; left: number; top: number; size: number; rotate?: number; dark?: boolean; press?: boolean }) {
  const padding = press ? 8 : 10;
  const gap = 8;
  const tile = (size - padding * 2 - gap) / 2;
  return <div style={{ ...absolute, left, top, width: size, height: size, padding, gap, display: "flex", flexWrap: "wrap", borderRadius: press ? 12 : "45px 12px 45px 12px", background: dark ? "#38533e" : colors.white, boxShadow: dark ? "0 20px 45px #081b13" : "0 14px 35px #273b3425", transform: `rotate(${rotate}deg)` }}>
    {[0, 1, 2, 3].map(index => <Cover key={index} source={page.collage?.[index]} artwork={artwork} size={tile} dark={dark} style={{ borderRadius: index === 0 || index === 3 ? "32px 5px 32px 5px" : 5 }} />)}
  </div>;
}
function FlowerPhoto({ source, artwork, left, top, size }: { source?: string; artwork: Record<string, string>; left: number; top: number; size: number }) {
  const image = source && artwork[source + "#flower"];
  return <div style={{ ...absolute, left, top, width: size, height: size }}>
    {image && <img src={image} width={size} height={size} style={{ ...absolute, left: 0, top: 0 }} alt="" />}
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ ...absolute, left: 0, top: 0 }}>
      <circle cx="50" cy="50" r="49" fill="none" stroke={colors.ink} strokeWidth=".16" />
      {!image && flowerShape({ color: colors.ink, paper: colors.pink })}
      <g fill={colors.green}><circle cx="4" cy="51" r=".6" /><circle cx="96" cy="51" r=".6" /></g>
    </svg>
  </div>;
}

function PaperArt({ page, artwork }: { page: OgPreviewPage; artwork: Record<string, string> }) {
  if (page.kind === "brand" || page.kind === "page") return <BrandPlanet />;
  if (page.kind === "artist" || page.kind === "bloom") return <>
    <div style={{ ...absolute, left: 704, top: 114, width: 452, height: 418, border: "1px solid #d4ddce", borderRadius: "50%", transform: "rotate(-18deg)" }} />
    <Botanical left={683} top={89} width={556} height={487} opacity={.85} />
    <Cover source={page.artwork} artwork={artwork} size={377} style={{ ...absolute, left: 744, top: 132, borderRadius: "190px 190px 16px 16px", border: "7px solid #fcfcf5", boxShadow: "0 16px 35px #273b341f" }} />
    <Mark size={64} color={colors.petal} style={{ ...absolute, left: 715, top: 440, transform: "rotate(-14deg)" }} />
  </>;
  if (page.kind === "playlist") return <><Botanical left={679} top={89} width={556} height={487} opacity={.7} /><Mosaic page={page} artwork={artwork} left={742} top={138} size={372} rotate={-5} /><Mark size={65} color={colors.petal} style={{ ...absolute, left: 1083, top: 462, transform: "rotate(13deg)" }} /></>;
  if (page.kind === "mix") return <>
    <Vinyl left={837} top={182} size={338} rose />
    <Cover source={page.collage?.[1]} artwork={artwork} size={303} style={{ ...absolute, left: 733, top: 153, transform: "rotate(-9deg)", border: "7px solid #fcfcf5", boxShadow: "0 10px 30px #273b3422" }} />
    <Cover artwork={artwork} size={337} mix style={{ ...absolute, left: 754, top: 144, transform: "rotate(6deg)", border: "9px solid #fcfcf5", borderRadius: "8px 8px 34px 8px", boxShadow: "0 16px 40px #273b3429" }} />
    <Mark size={54} color={colors.petal} style={{ ...absolute, left: 713, top: 429 }} />
  </>;
  const size = page.kind === "lyric" ? 272 : 336;
  return <>
    <Vinyl left={page.kind === "lyric" ? 898 : 844} top={page.kind === "lyric" ? 228 : 186} size={page.kind === "lyric" ? 278 : 354} />
    <Botanical left={729} top={99} width={494} height={420} opacity={.65} />
    <Cover source={page.artwork} artwork={artwork} size={size} style={{ ...absolute, left: page.kind === "lyric" ? 856 : 749, top: page.kind === "lyric" ? 164 : 143, transform: "rotate(-7deg)", border: "9px solid #fcfcf5", borderRadius: 5, boxShadow: "0 18px 35px #273b3426" }} />
  </>;
}
function Paper({ page, artwork }: { page: OgPreviewPage; artwork: Record<string, string> }) {
  const lyric = page.kind === "lyric";
  return <div style={{ width: 1200, height: 630, position: "relative", display: "flex", background: colors.paper, color: colors.ink, fontFamily: "Inter", overflow: "hidden" }}>
    <div style={{ ...absolute, left: 907, top: -83, width: 533, height: 660, borderRadius: "50%", background: "#e8edde", opacity: .6 }} />
    <Grain /><PaperArt page={page} artwork={artwork} /><Petals />
    <Brand /><div style={{ ...absolute, left: 938, top: 65, fontSize: 11, letterSpacing: 1.7, color: colors.muted }}>MUSIC, WITH A LITTLE SOUL.</div>
    <Eyebrow text={page.eyebrow} />
    {lyric && <div style={{ ...absolute, left: 56, top: 192, fontFamily: "Fraunces", fontWeight: 600, fontSize: 99, lineHeight: 1, color: colors.petal }}>“</div>}
    <Title title={page.title} left={lyric ? 96 : 62} top={214} width={lyric ? 721 : 645} size={lyric ? 78 : page.kind === "artist" ? 108 : 97} italic={lyric} />
    <Caption page={page} width={lyric ? 730 : 623} />
    <Footer page={page} />
  </div>;
}

function NightArt({ page, artwork }: { page: OgPreviewPage; artwork: Record<string, string> }) {
  if (page.kind === "brand" || page.kind === "page") return <BrandPlanet dark />;
  const portrait = (page.darkArtwork && artwork[page.darkArtwork]) || (page.artwork && artwork[page.artwork]);
  if ((page.kind === "artist" || page.kind === "bloom") && portrait) return <>
    <div style={{ ...absolute, left: 611, top: 0, width: 589, height: 630, overflow: "hidden" }}><img src={portrait} width={589} height={630} style={{ objectFit: "cover" }} alt="" /></div>
    <div style={{ ...absolute, left: 585, top: 0, width: 615, height: 630, background: "linear-gradient(90deg, #15291f 0%, #15291fe3 14%, #15291f55 52%, #15291f24 100%)" }} />
    <div style={{ ...absolute, left: 590, top: 406, width: 610, height: 224, background: "linear-gradient(0deg, #15291f 0%, #15291f66 50%, #15291f00 100%)" }} />
    <Botanical left={824} top={276} width={398} height={317} dark opacity={.6} />
  </>;
  if (page.kind === "playlist") return <><Vinyl left={867} top={191} size={370} dark label={false} />{page.artwork && artwork[page.artwork] ? <Cover source={page.artwork} artwork={artwork} size={383} dark style={{ ...absolute, left: 753, top: 126, transform: "rotate(8deg)", border: "10px solid #38533e", borderRadius: "45px 12px 45px 12px", boxShadow: "0 20px 45px #081b13" }}/> : <Mosaic page={page} artwork={artwork} left={753} top={126} size={383} rotate={8} dark />}</>;
  if (page.kind === "mix") return <>
    <Vinyl left={821} top={167} size={387} dark />
    <Cover source={page.collage?.[page.artwork ? 1 : 0]} artwork={artwork} size={312} dark style={{ ...absolute, left: 723, top: 142, transform: "rotate(-8deg)", border: "6px solid #445c43", boxShadow: "0 20px 40px #081b13" }} />
    <Cover source={page.artwork} artwork={artwork} size={337} dark mix style={{ ...absolute, left: 772, top: 157, transform: "rotate(7deg)", border: "7px solid #667c5c", borderRadius: "4px 4px 35px 4px", boxShadow: "0 20px 40px #081b13" }} />
    <Botanical left={966} top={330} width={272} height={238} dark opacity={.75} />
  </>;
  if (!portrait && (page.kind === "artist" || page.kind === "bloom")) return <BrandPlanet dark />;
  const lyric = page.kind === "lyric";
  return <>
    <Vinyl left={lyric ? 921 : 875} top={lyric ? 233 : 181} size={lyric ? 265 : 350} dark />
    <Cover source={page.artwork} artwork={artwork} size={lyric ? 269 : 343} dark style={{ ...absolute, left: lyric ? 853 : 750, top: lyric ? 172 : 130, border: "7px solid #4d674c", borderRadius: "4px 4px 27px 4px", transform: "rotate(5deg)", boxShadow: "0 20px 50px #081b13" }} />
    <Botanical left={917} top={326} width={321} height={241} dark opacity={.8} />
  </>;
}
function Night({ page, artwork }: { page: OgPreviewPage; artwork: Record<string, string> }) {
  const lyric = page.kind === "lyric";
  return <div style={{ display: "flex", position: "relative", width: 1200, height: 630, overflow: "hidden", fontFamily: "Inter", background: colors.night, color: colors.moon }}>
    <div style={{ ...absolute, left: 660, top: -130, width: 700, height: 790, borderRadius: "50%", background: "radial-gradient(circle at 40% 45%, #456449 0%, #2a4531 33%, #15291f 72%)", opacity: .63 }} />
    <NightArt page={page} artwork={artwork} /><Grain dark /><Petals dark />
    <Brand dark /><div style={{ ...absolute, left: 950, top: 65, fontSize: 11, letterSpacing: 1.7, color: colors.sage }}>LET THE WORLD WAIT A LITTLE.</div>
    <Eyebrow text={page.eyebrow} dark />
    {lyric && <div style={{ ...absolute, left: 52, top: 195, fontFamily: "Fraunces", fontWeight: 600, fontSize: 103, lineHeight: 1, color: colors.petal }}>“</div>}
    <Title title={page.title} left={lyric ? 95 : 62} top={212} width={lyric ? 737 : 654} size={lyric ? 78 : page.kind === "artist" ? 109 : 99} color={colors.moon} italic={lyric} />
    <Caption page={page} width={lyric ? 737 : 625} dark />
    <Footer page={page} dark />
  </div>;
}

function PressArt({ page, artwork }: { page: OgPreviewPage; artwork: Record<string, string> }) {
  if (page.kind === "artist" || page.kind === "bloom") return <>
    <FlowerPhoto source={page.artwork} artwork={artwork} left={62} top={112} size={423} />
    <svg width="480" height="450" viewBox="0 0 480 450" style={{ ...absolute, left: 39, top: 101 }}><ellipse cx="245" cy="225" rx="234" ry="159" transform="rotate(-39 245 225)" fill="none" stroke={colors.green} strokeWidth=".7" /><path d="m83 394 19-20m-16-2 19 21" stroke={colors.green} strokeWidth=".8" /><path d="M433 91h14m-7-7v14" stroke={colors.green} strokeWidth="1" /></svg>
  </>;
  if (page.kind === "playlist") return <><Botanical left={15} top={81} width={496} height={457} opacity={.7} outline /><Mosaic page={page} artwork={artwork} left={86} top={156} size={349} rotate={-4} press /><Mark size={65} color={colors.green} paper={colors.pink} style={{ ...absolute, left: 427, top: 137, transform: "rotate(12deg)" }} /></>;
  if (page.kind === "mix") return <>
    <Vinyl left={130} top={134} size={388} rose />
    <Cover artwork={artwork} size={291} mix style={{ ...absolute, left: 73, top: 173, transform: "rotate(-8deg)", border: "9px solid #f5f5ee", borderRadius: 4, boxShadow: "0 14px 30px #4b3c3828" }} />
    <Mark size={75} color={colors.ink} paper={colors.pink} style={{ ...absolute, left: 416, top: 450, transform: "rotate(-17deg)" }} />
  </>;
  if (page.kind === "album" || page.kind === "track") return <>
    <Vinyl left={221} top={189} size={340} />
    <Cover source={page.artwork} artwork={artwork} size={344} style={{ ...absolute, left: 62, top: 137, transform: "rotate(-6deg)", border: "10px solid #f5f5ee", borderRadius: 4, boxShadow: "0 13px 35px #51372c2a" }} />
    <Mark size={58} color={colors.green} paper={colors.pink} style={{ ...absolute, left: 448, top: 108 }} />
  </>;
  return <>
    <div style={{ ...absolute, left: 75, top: 138, width: 371, height: 371, borderRadius: "50%", border: "1px solid #bf9690", background: "#edd4ca" }} />
    <Mark size={313} color={colors.ink} paper="#e4c6bd" style={{ ...absolute, left: 104, top: 164, transform: "rotate(-12deg)" }} />
    <Botanical left={-14} top={107} width={519} height={428} opacity={.6} outline />
    <svg width="495" height="436" viewBox="0 0 495 436" style={{ ...absolute, left: 12, top: 116 }}><ellipse cx="249" cy="230" rx="235" ry="154" transform="rotate(-38 249 230)" fill="none" stroke={colors.ink} strokeWidth=".6" /><circle cx="67" cy="343" r="3" fill={colors.green} /></svg>
  </>;
}
function Press({ page, artwork }: { page: OgPreviewPage; artwork: Record<string, string> }) {
  const brand = page.kind === "brand";
  const lyric = page.kind === "lyric";
  return <div style={{ display: "flex", position: "relative", width: 1200, height: 630, overflow: "hidden", fontFamily: "Inter", background: colors.pink, color: colors.ink }}>
    <div style={{ ...absolute, left: 0, top: 0, width: 1200, height: 557, background: "linear-gradient(115deg, #ead0c4 0%, #e1beb7 58%, #d4ada4 100%)" }} />
    <Grain /><Brand small left={61} top={37} /><div style={{ ...absolute, left: 918, top: 52, fontSize: 11, fontWeight: 600, letterSpacing: 2, color: colors.green }}>A LITTLE ROOM TO LISTEN.</div>
    <div style={{ ...absolute, left: 64, top: 93, width: 1072, height: 1, background: "#c69f96" }} />
    {brand ? <>
      <BrandPlanet press />
      <div style={{ ...absolute, left: 59, top: 148, fontFamily: "Fraunces", fontWeight: 600, fontSize: 161, letterSpacing: -9, lineHeight: 1 }}>sakura</div>
      <div style={{ ...absolute, left: 64, top: 335, fontFamily: "Fraunces", fontWeight: 600, fontStyle: "italic", fontSize: 54, letterSpacing: -2.5 }}>Your little music world.</div>
      <div style={{ ...absolute, left: 66, top: 430, fontSize: 23, color: colors.green }}>{page.subtitle}</div>
      <div style={{ ...absolute, left: 66, top: 482, fontSize: 14, color: colors.green }}>{page.detail}</div>
    </> : lyric ? <>
      <FlowerPhoto source={page.artwork} artwork={artwork} left={890} top={212} size={276} />
      <Eyebrow text={page.eyebrow} left={64} top={151} />
      <div style={{ ...absolute, left: 56, top: 188, fontFamily: "Fraunces", fontWeight: 600, fontSize: 110, lineHeight: 1, color: colors.green }}>“</div>
      <Title title={page.title} left={104} top={215} width={760} size={86} italic />
      <Caption page={page} left={64} width={785} top={452} detailTop={509} />
    </> : <>
      <PressArt page={page} artwork={artwork} />
      <Eyebrow text={page.eyebrow} left={586} top={168} width={554} />
      <Title title={page.title} left={583} top={218} width={553} size={page.kind === "artist" ? 91 : 88} />
      <Caption page={page} left={587} width={540} top={444} detailTop={509} />
    </>}
    <Footer page={page} press />
  </div>;
}

export async function renderOgImage(page: OgPreviewPage, direction: OgDirection, artworkOverrides: Record<string, string> = {}, headers: Record<string, string> = {}) {
  const [fonts, artwork] = await Promise.all([fontsForText([page.title, page.subtitle, page.detail, page.eyebrow, page.action].join(" ")), localArtworkFor(page)]);
  const components: Record<OgDirection, (props: { page: OgPreviewPage; artwork: Record<string, string> }) => ReactElement> = { a: Paper, b: Night, c: Press };
  const Component = components[direction];
  return new ImageResponse(<Component page={page} artwork={{ ...artwork, ...artworkOverrides }} />, { ...OG_SIZE, fonts, headers });
}
export function renderOgPreview(page: OgPreviewPage, direction: OgDirection, headers: Record<string, string> = {}) { return renderOgImage(page, direction, {}, headers); }
