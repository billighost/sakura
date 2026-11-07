"use client";

import { useId, type CSSProperties } from "react";
import { BloomLettering } from "../Lettering";
import type { BloomQuality, BloomSceneKind, BloomWorldProps } from "../types";
import s from "./world.module.css";

const tiers = {
  1: { books: 3, needles: 4, branches: 7, flowers: 5, marks: 18, dust: 0, silk: 4 },
  2: { books: 4, needles: 6, branches: 10, flowers: 9, marks: 34, dust: 3, silk: 6 },
  3: { books: 6, needles: 8, branches: 15, flowers: 16, marks: 58, dust: 8, silk: 10 },
  4: { books: 8, needles: 11, branches: 23, flowers: 25, marks: 95, dust: 16, silk: 15 },
  5: { books: 11, needles: 15, branches: 34, flowers: 39, marks: 160, dust: 30, silk: 23 },
} as const;
const seed = (n: number) => { const v = Math.sin(n * 83.17 + 19.71) * 19471.31; return v - Math.floor(v); };
const inks = ["#d9b360", "#bd764f", "#b39d60", "#81936a", "#7b6983", "#ccaf78"];
type Detail = { [Key in keyof (typeof tiers)[1]]: number };

function Blossom({ x = 0, y = 0, size = 1, warm = false }: { x?: number; y?: number; size?: number; warm?: boolean }) {
  return <g transform={`translate(${x} ${y}) scale(${size})`}>
    <g fill={warm ? "#c7796f" : "#eee1ba"} stroke={warm ? "#a45f58" : "#c1a478"} strokeWidth=".6">
      <path d="M0 2C-12-1-14-14-6-18C1-19 4-7 0 2Z"/>
      <path d="M0 2C-2-12 8-20 15-13C20-5 8 4 0 2Z"/>
      <path d="M0 2C12-6 23-1 20 7C15 17 4 11 0 2Z"/>
      <path d="M0 2C12 10 11 23 3 23C-9 20-6 7 0 2Z"/>
      <path d="M0 2C-7 15-22 14-22 6C-19-5-5-3 0 2Z"/>
    </g>
    <circle r="3.2" fill="#bf9348"/><path d="M-2-2-6-7M2-2 7-7M3 2 11 4M0 3 1 11M-3 2-10 6" fill="none" stroke="#68563c" strokeWidth=".7"/>
    <g fill="#d5ad55"><circle cx="-6" cy="-7" r="1"/><circle cx="7" cy="-7" r="1"/><circle cx="11" cy="4" r="1"/><circle cx="1" cy="11" r="1"/></g>
  </g>;
}

function Books({ x, y, width, amount, variant }: { x: number; y: number; width: number; amount: number; variant: number }) {
  return <g transform={`translate(${x} ${y})`}>
    {Array.from({ length: amount }, (_, i) => {
      const height = 9 + seed(i + variant) * 8, w = width - seed(i + variant + 9) * width * .2;
      return <g key={i} transform={`translate(${i % 2 ? 4 : 0} ${-i * 14})`}>
        <path d={`M0 0H${w}V${height}H0Z`} fill={inks[(i + variant) % inks.length]} stroke="#5c513c" strokeWidth="1"/>
        <path d={`M${w * .18} 0V${height}M${w * .8} 0V${height}`} stroke="#78603c" strokeWidth=".8"/>
        <path d={`M3 ${height / 2}H${w - 3}M4 ${height - 3}H${w - 4}`} stroke="#f5dfae" strokeOpacity=".52" strokeWidth=".6"/>
        <path d={`M0 0 ${w * .09} -4H${w + 2}L${w} 0`} fill="#e4cb92" stroke="#846647" strokeWidth=".7"/>
        <path d={`M${w * .18} 1q-6 4 0 8M${w * .8} 1q6 4 0 8`} fill="none" stroke="#3f3a35" strokeWidth="1"/>
      </g>;
    })}
  </g>;
}

function Vessel({ x, y, size = 1, type = 0, rich = false }: { x: number; y: number; size?: number; type?: number; rich?: boolean }) {
  const ceramic = type % 3 === 0 ? "#c1c4a2" : type % 3 === 1 ? "#537975" : "#c29075";
  return <g transform={`translate(${x} ${y}) scale(${size})`}>
    <ellipse cx="0" cy="6" rx="31" ry="6" fill="#141b28" opacity=".23"/>
    <path d="M-13-69H13L10-54C12-43 32-39 32-20Q34 7 0 8Q-34 7-32-20C-32-39-12-43-10-54Z" fill={ceramic} stroke="#434b45" strokeWidth="1.5"/>
    <path d="M-11-65H11M-25-31Q0-41 25-31M-30-13Q0-20 30-13" fill="none" stroke="#e6d7b0" strokeOpacity=".65" strokeWidth="1"/>
    <path d="M-15-48Q-25-31-19-10Q-12 3-6 1" fill="none" stroke="#f8ebc5" strokeOpacity=".26" strokeWidth="5"/>
    <path d="M-11-70Q0-74 11-70Q0-65-11-70Z" fill="#354b4a"/>
    {rich && <g fill="none" stroke="#efe3bd" strokeOpacity=".65" strokeWidth="1.2"><path d="M-5-16Q-13-29-4-35Q8-38 8-23Q5-15-5-16M0-17Q0-30-10-34M-1-27Q10-38 14-27M-7-10Q2-8 11-12"/><path d="M-19-1q19 7 39 0"/></g>}
  </g>;
}

function FlowerSpray({ count, rich }: { count: number; rich: boolean }) {
  return <g>
    <path d="M0 25C2-16 39-20 22-88Q9-141 69-173M21-64Q-28-63-45-105M30-112Q73-89 108-121M40-150Q26-179 11-181" fill="none" stroke="#4a5140" strokeWidth="2.5" strokeLinecap="round"/>
    {Array.from({ length: count }, (_, i) => {
      const x = -38 + seed(i * 5 + 2) * 135, y = -68 - seed(i * 5 + 10) * 113;
      return <g key={i}>
        <path d={`M22-79Q${x * .5} ${y - 6} ${x} ${y}`} fill="none" stroke="#687158" strokeWidth=".8"/>
        <Blossom x={x} y={y} size={.23 + seed(i + 5) * .25} warm={i % 4 === 0}/>
        {rich && <path d={`M${x - 3} ${y + 11}q-18-14-21-2 12 12 21 2`} fill="#6c8563"/>}
      </g>;
    })}
  </g>;
}

function Cabinet({ side, detail, quality }: { side: "left" | "right"; detail: Detail; quality: BloomQuality }) {
  const mirror = side === "right";
  return <g transform={mirror ? "translate(1600 0) scale(-1 1)" : undefined}>
    <g fill="#33364b" stroke="#b2935e" strokeWidth="1.2">
      <path d="M106 170H419V790H106Z"/><path d="M121 184H404V775H121Z" fill="#56554c"/>
      <path d="M121 184 143 207H381L404 184Z" fill="#777365"/>
      <path d="M143 207V763L121 775V184Z" fill="#252b3c"/>
      <path d="M381 207V763L404 775V184Z" fill="#727161"/>
    </g>
    {[360, 545, 760].map(y => <g key={y}><path d={`M123 ${y}H401V${y + 13}H123Z`} fill="#bd9b64" stroke="#3f3d36" strokeWidth="1"/><path d={`M143 ${y - 8}H381L401 ${y}H123Z`} fill="#81816c"/></g>)}
    <path d="M255 187V774" stroke="#b49564" strokeWidth="9"/><path d="M259 191V774" stroke="#323345" strokeWidth="4"/>
    <Books x={153} y={326} width={83} amount={detail.books} variant={mirror ? 2 : 0}/>
    <Books x={281} y={739} width={91} amount={Math.max(3, detail.books - 1)} variant={mirror ? 4 : 2}/>
    <Books x={159} y={735} width={69} amount={Math.max(2, detail.books - 3)} variant={3}/>
    <Vessel x={195} y={523} size={1.14} rich={quality >= 3} type={mirror ? 1 : 0}/>
    <g transform="translate(195 439) scale(.62)"><FlowerSpray count={Math.ceil(detail.flowers / 3)} rich={quality >= 4}/></g>
    <Vessel x={323} y={335} size={.75} type={2} rich={quality >= 3}/>
    <Vessel x={326} y={520} size={1.35} type={1} rich={quality >= 3}/>
    <path d="M300 430H344V458H300Z" fill="#cda96a" stroke="#4b5549" strokeWidth="1.4"/><path d="M303 435H341M304 448H340" stroke="#edddac" strokeWidth="1.2"/>
    <g stroke="#74644b" strokeWidth="2"><path d="M306 432 302 371M314 432 320 357M327 432 324 382M336 432 346 372"/><path d="M301 379 301 369M320 364 321 351M324 387 322 378" stroke="#252e37" strokeWidth="5"/></g>
    <g fill="#c78355" stroke="#775a3c" strokeWidth="1"><circle cx="192" cy="695" r="14"/><circle cx="211" cy="687" r="13"/><circle cx="217" cy="706" r="12"/></g>
    <path d="M184 699Q204 693 230 707L224 718H187Z" fill="#728c70" stroke="#4a604f" strokeWidth="1"/>
    {quality >= 3 && <g stroke="#aa8754" strokeWidth="1" fill="none"><path d="M130 194H394V767H130Z"/><path d="M267 194V766"/>{[350, 533, 752].map(y => <path key={y} d={`M130 ${y}H394`}/>)}</g>}
    {quality >= 4 && <g fill="#dfb16c">{[193, 527, 758].map(y => <g key={y}><circle cx="128" cy={y} r="2"/><circle cx="392" cy={y} r="2"/></g>)}</g>}
  </g>;
}

function Pine({ detail, side, quality }: { detail: Detail; side: "left" | "right"; quality: BloomQuality }) {
  return <svg className={`${s.pine} ${side === "right" ? s.pineRight : s.pineLeft}`} viewBox="0 0 520 600" preserveAspectRatio="xMinYMin meet" aria-hidden="true">
    <g transform={side === "right" ? "translate(520 0) scale(-1 1)" : undefined}>
      <path d="M-68 591C-9 478 16 359 58 264C83 213 76 164 20 117L-40 82L-27 41Q109 83 126 159C160 128 216 127 256 94Q303 56 385 60L389 81C318 79 304 113 267 141Q210 177 134 181C148 240 74 336 49 442Q29 534 25 610Z" fill="#303a38"/>
      <path d="M-20 554Q8 427 73 263Q115 174 54 116M105 172Q201 161 255 124Q304 87 368 77" fill="none" stroke="#7e846c" strokeWidth="5" strokeOpacity=".5"/>
      <path d="M97 232Q207 240 279 187Q323 145 421 168M50 348Q109 362 194 333M20 448Q99 472 153 442M45 101Q149 74 183 37" fill="none" stroke="#343f38" strokeWidth="10" strokeLinecap="round"/>
      {Array.from({ length: detail.branches }, (_, i) => {
        const x = 48 + seed(i + 12) * 375, y = 31 + seed(i + 23) * 355, radius = 19 + seed(i + 47) * 27;
        return <g key={i} className={quality >= 3 && i % (quality === 5 ? 2 : 4) === 0 ? s.needleSway : undefined} style={{ "--delay": `${-i * .37}s` } as CSSProperties}>
          <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${Math.round(seed(i + 42) * 26 - 13)})`}>
            <path d={`M0 9Q-4-4 0 ${-radius}`} fill="none" stroke="#4b5c47" strokeWidth="1.2"/>
            {Array.from({ length: detail.needles }, (_, n) => {
              const angle = (-165 + n * 155 / Math.max(1, detail.needles - 1)) * Math.PI / 180;
              const dx = Math.cos(angle) * radius, dy = Math.sin(angle) * radius;
              return <path key={n} d={`M0 10Q${(dx * .5).toFixed(1)} ${(dy * .55).toFixed(1)} ${dx.toFixed(1)} ${dy.toFixed(1)}`} fill="none" stroke={n % 3 === 0 ? "#919b75" : "#4c614c"} strokeWidth={quality >= 4 ? 1.3 : 1.7} strokeLinecap="round"/>;
            })}
            {quality >= 4 && <g fill="#b9ae7b" opacity=".55"><ellipse cx="-3" cy="5" rx="2" ry="4"/><ellipse cx="3" cy="8" rx="2" ry="4"/></g>}
          </g>
        </g>;
      })}
      {quality >= 4 && <g fill="#a8a788" opacity=".4">{Array.from({ length: 25 }, (_, i) => <path key={i} d={`M${24 + seed(i + 99) * 68} ${138 + i * 14}l8-3 3 7-9 4Z`}/>)}</g>}
    </g>
  </svg>;
}

function Magpie({ detailed }: { detailed: boolean }) {
  return <svg viewBox="0 0 180 180" aria-hidden="true">
    <path d="M71 115 11 165 58 144 37 178 91 124Z" fill="#263645" stroke="#e7d9b3" strokeWidth="1"/>
    <path d="M65 71C39 84 52 118 79 129Q120 142 135 105C142 90 126 78 110 74L116 53Q105 30 86 42Q65 42 65 71Z" fill="#273747" stroke="#19292f" strokeWidth="1.5"/>
    <path d="M58 82Q79 61 94 85Q108 115 76 120Q63 109 58 82Z" fill="#e8dfbe"/>
    <path d="M84 88Q112 79 125 101Q119 118 94 128L78 122Q103 107 84 88Z" fill="#52706d"/>
    <path d="M96 45Q111 37 115 54L108 67 91 61Z" fill="#1f303c"/><path d="M114 51 139 58 114 64Z" fill="#a58e5d"/>
    <circle cx="107" cy="51" r="3" fill="#f2e6bc"/><circle cx="108" cy="51" r="1.6" fill="#202b31"/>
    <path d="M84 124 86 146 73 153M106 126 111 143 99 151M85 144 100 148M110 143 124 147" stroke="#5b5a43" strokeWidth="2" fill="none"/>
    {detailed && <g fill="none" stroke="#a2b4a1" strokeWidth="1" opacity=".7"><path d="M89 94Q113 95 121 104M89 99Q106 105 116 111M86 105Q98 112 108 117M43 151 77 126M60 148 85 130"/></g>}
  </svg>;
}

function Tiger({ rich }: { rich: boolean }) {
  return <svg viewBox="0 0 430 350" aria-hidden="true">
    <path className={s.tigerTail} d="M293 225C363 221 389 146 360 118Q340 109 335 124Q333 141 350 137" fill="none" stroke="#b4a16b" strokeWidth="20" strokeLinecap="round"/>
    <path d="M121 149C130 108 234 106 283 158Q320 189 304 253L287 309H239L232 278Q193 297 151 278L125 310H85L101 247Q80 194 121 149Z" fill="#bdac75" stroke="#4b5544" strokeWidth="2"/>
    <path d="M138 174Q106 160 86 177Q37 169 30 122Q14 98 32 78L46 78Q82 48 123 79L147 76Q161 98 147 121Q164 142 138 174Z" fill="#c5b781" stroke="#3d4c43" strokeWidth="2"/>
    <path d="M46 79 33 69 32 91M124 79 143 68 145 91" fill="#726c53" stroke="#d7c48e" strokeWidth="3"/>
    <path d="M39 106Q51 84 73 100Q73 125 50 123Z" fill="#ead9a1" stroke="#59533e" strokeWidth="1.5"/>
    <path d="M94 100Q117 83 133 106L123 124Q104 126 94 100Z" fill="#ead9a1" stroke="#59533e" strokeWidth="1.5"/>
    <g className={s.tigerEyes} fill="#333c36"><ellipse cx="62" cy="106" rx="5" ry="9"/><ellipse cx="112" cy="106" rx="5" ry="9"/></g>
    <path d="M73 123Q86 115 96 124L87 137Z" fill="#655143"/><path d="M45 140Q82 162 126 139Q110 171 75 167Q53 163 45 140Z" fill="#864c43"/>
    <path d="M55 149 62 159 69 153 77 163 85 156 94 164 101 155 111 157 117 148" fill="none" stroke="#f3dfb5" strokeWidth="3"/>
    <path d="M38 126 8 118M42 137 10 140M128 126 158 118M126 139 161 143" stroke="#424b41" strokeWidth="1.1"/>
    <g fill="#454e42">
      <path d="M80 78 79 103 86 90 91 77Z"/><path d="M42 93 54 96 47 100 34 102Z"/><path d="M118 91 132 90 139 101 123 98Z"/>
      <path d="M132 156Q153 146 167 132L170 156 146 173Z"/><path d="M169 189Q173 156 196 130L205 139Q188 163 181 195Z"/>
      <path d="M206 214Q224 180 234 143L250 156Q240 189 222 219Z"/><path d="M250 235Q276 217 294 180L302 196Q292 225 270 248Z"/>
      <path d="M117 213 140 225 125 230 105 219Z"/><path d="M118 242 141 252 127 259 105 251Z"/><path d="M257 277 280 274 275 286 255 290Z"/>
    </g>
    {rich && <g fill="none" stroke="#4c5948" strokeWidth="2" opacity=".8"><path d="M162 235q24-8 31-29m-26 53q21-7 35-26M297 226q18-13 22-25M328 185l12 5m5-29 14 3m0-36 12-8"/><path d="M55 90q-10-7-20 0m85-4q14-7 21 0M57 133q13 8 18 0m22 0q10 8 17-1"/></g>}
    {rich && <g fill="none" stroke="#786f4d" strokeWidth=".7" opacity=".6">
      {Array.from({length: 47}, (_, i) => { const x=119+seed(i+600)*171, y=163+seed(i+613)*102;return <path key={i} d={`M${x} ${y}q${2+seed(i+607)*4} -4 ${6+seed(i+618)*7} -2`}/>; })}
      <path d="M44 131q16 10 24 5m35 0q16 5 25-5M77 136v6m10-5v9m11-7v5"/>
    </g>}
    {rich && <g fill="#424d42"><circle cx="49" cy="130" r="1.5"/><circle cx="57" cy="133" r="1.5"/><circle cx="63" cy="128" r="1.5"/><circle cx="114" cy="131" r="1.5"/><circle cx="121" cy="128" r="1.5"/><circle cx="107" cy="133" r="1.5"/></g>}
    <path d="M95 302H126M246 302H282" stroke="#dfc991" strokeWidth="2"/>
    <ellipse cx="201" cy="321" rx="156" ry="10" fill="#182833" opacity=".14"/>
  </svg>;
}

function CourtyardTitle() {
  return <svg className={s.brushTitle} viewBox="0 0 550 168" aria-hidden="true">
    <g className={s.titleInk} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 127Q38 76 58 26Q70 1 75 17Q81 45 40 88" strokeWidth="8"/>
      <path d="M36 100Q68 62 90 83Q112 109 81 125Q53 139 30 118" strokeWidth="10"/>
      <path d="M120 129Q135 92 154 38Q165 4 174 13Q183 35 146 84Q130 109 132 123Q136 139 155 120" strokeWidth="7"/>
      <path d="M205 79Q177 77 173 108Q168 132 193 136Q220 139 231 107Q237 80 216 78Q197 76 186 96" strokeWidth="9"/>
      <path d="M279 77Q247 81 246 113Q249 138 275 135Q302 133 310 104Q315 76 294 77Q278 75 265 92" strokeWidth="9"/>
      <path d="M326 132 345 85Q350 73 354 84L347 107" strokeWidth="8"/>
      <path d="M347 107Q386 67 386 89L372 129Q411 69 423 87L414 119Q411 138 432 122" strokeWidth="8"/>
      <path d="M20 150Q109 138 198 149Q310 165 425 145" strokeWidth="1.3" opacity=".46"/>
      <path d="M429 143Q469 150 481 126Q496 104 530 118M473 139Q469 119 458 111" strokeWidth="1.7"/>
    </g>
    <path d="M59 49Q72 19 77 20M126 121 145 75M177 111Q174 127 193 133M257 113Q257 127 278 131" stroke="#eee0b8" strokeWidth="1.3" fill="none" opacity=".3"/>
    <Blossom x={492} y={115} size={.43} warm/><Blossom x={456} y={110} size={.26}/>
    <path d="M482 131q-19-12-23 0 11 10 23 0M505 112q19-15 23-4-10 14-23 4" fill="#83916b"/>
  </svg>;
}

function PaintedScreen({ id, detail, quality, evening }: { id: string; detail: Detail; quality: BloomQuality; evening: number }) {
  const colour = (name: string) => `url(#${id}-${name})`;
  return <svg className={s.screen} viewBox="0 0 1600 1000" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <linearGradient id={`${id}-wall`} x2="0" y2="1"><stop stopColor="#cfbd94"/><stop offset=".55" stopColor="#ebdec0"/><stop offset="1" stopColor="#a6a38a"/></linearGradient>
      <linearGradient id={`${id}-paper`} x2="1" y2=".8"><stop stopColor="#d9c89f"/><stop offset=".34" stopColor="#f1e5c6"/><stop offset=".72" stopColor="#e4d5af"/><stop offset="1" stopColor="#d0b98b"/></linearGradient>
      <linearGradient id={`${id}-lacquer`} x2="0" y2="1"><stop stopColor="#272d42"/><stop offset=".6" stopColor="#474250"/><stop offset="1" stopColor="#242e40"/></linearGradient>
      <linearGradient id={`${id}-court`} x2="0" y2="1"><stop stopColor="#738a77"/><stop offset=".6" stopColor="#a7b091"/><stop offset="1" stopColor="#ded0a4"/></linearGradient>
      <pattern id={`${id}-silk`} width="32" height="32" patternUnits="userSpaceOnUse"><path d="M0 16Q8 4 16 16T32 16M0 31Q8 19 16 31T32 31" fill="none" stroke="#cfa86d" strokeWidth=".6" strokeOpacity=".22"/></pattern>
    </defs>
    <path d="M0 0H1600V1000H0Z" fill={colour("wall")}/>
    <path d="M0 813H1600V1000H0Z" fill="#777d6b"/><path d="M0 810H1600V844H0Z" fill="#9f9c7b"/>
    <g fill="none" stroke="#4b6559" strokeWidth="2" opacity=".32"><path d="M0 885H1600M0 970H1600M50 842-95 1000M270 842 195 1000M520 842 503 1000M770 842 777 1000M1020 842 1100 1000M1300 842 1460 1000"/></g>
    <ellipse cx="800" cy="831" rx="765" ry="31" fill="#243345" opacity=".27"/>
    <path d="M63 113 1537 113 1562 832H40Z" fill={colour("lacquer")} stroke="#7c644b" strokeWidth="3"/>
    <path d="M70 123H1530V808H70Z" fill={colour("silk")} stroke="#c4a46d" strokeWidth="1.2"/>
    {[76, 245, 426, 594, 800, 1006, 1174, 1355, 1524].map((x, i) => <g key={x} className={quality >= 3 && i % 2 === 0 ? s.panelBreath : undefined} style={{ "--delay": `${-i * .31}s` } as CSSProperties}>
      <path d={`M${x} 133V800`} fill="none" stroke={i % 2 ? "#c2a374" : "#141f33"} strokeWidth={i % 2 ? 1.3 : 4}/>
      {quality >= 3 && <path d={`M${x + 3} 135V794`} stroke="#e1c18b" strokeWidth=".55" opacity=".45"/>}
    </g>)}
    <path d="M453 161H1147V783H453Z" fill={colour("paper")} stroke="#bd9b65" strokeWidth="2"/>
    <path d="M470 178H1130V766H470Z" fill="none" stroke="#af8d5b" strokeWidth=".8"/>
    <g className={s.courtyardWindow}>
      <path d="M503 211H1097V656H503Z" fill={colour("court")}/>
      <circle cx="970" cy="299" r="57" fill="#e7c797" opacity={.38 + evening * .42}/>
      <path d="M503 446Q584 408 667 437Q746 381 825 425Q944 372 1097 429V656H503Z" fill="#7f967c"/>
      <path d="M503 532Q633 451 752 509Q899 437 1097 508V656H503Z" fill="#9ca682"/>
      <path d="M679 655Q704 576 837 538Q871 533 924 546Q811 587 798 655Z" fill="#d7c49a"/>
      <path d="M503 580H675V590H503M867 573H1097V585H867" fill="#545f4e"/>
      <path d="M574 504H638V577H574Z" fill="#a19874"/><path d="M556 505 600 470 657 505Z" fill="#52614e"/>
      <path d="M573 513H635M588 511V574M611 511V574" stroke="#505848" strokeWidth="2"/>
      {quality >= 3 && <g fill="#c2b585" opacity=".6">{Array.from({ length: detail.flowers }, (_, i) => <circle key={i} cx={515 + seed(i + 82) * 570} cy={490 + seed(i + 87) * 148} r={1 + seed(i + 8) * 2}/>)}</g>}
      <path d="M489 197H1111V669H489Z" fill="none" stroke="#59523e" strokeWidth="18"/>
      <path d="M492 200H1108V666H492Z" fill="none" stroke="#b39564" strokeWidth="2"/>
      <path d="M799 210V656M503 393H1097" fill="none" stroke="#6a654b" strokeWidth="6"/>
    </g>
    <g className={`${s.screenWing} ${s.screenWingLeft}`}><Cabinet side="left" detail={detail} quality={quality}/></g>
    <g className={`${s.screenWing} ${s.screenWingRight}`}><Cabinet side="right" detail={detail} quality={quality}/></g>
    <path d="M447 777H1153V791H447Z" fill="#b79766" stroke="#6d634a" strokeWidth="1"/>
    <path d="M461 783H1139" stroke="#f0d3a0" strokeWidth="1"/>
    <g fill="none" stroke="#c2a36c" strokeWidth="1" opacity=".7"><path d="M92 146H1508V794H92Z"/><path d="M92 143q15-15 30 0m1368 0q15-15 30 0M92 797q15 15 30 0m1368 0q15 15 30 0"/></g>
    {quality >= 3 && <g fill="none" stroke="#cca873" strokeWidth=".8" opacity=".35">{Array.from({ length: 20 + quality * 8 }, (_, i) => <path key={i} d={`M${98 + i * 1405 / (19 + quality * 8)} 132q6-8 12 0q-6 8-12 0m0 665q6-8 12 0q-6 8-12 0`}/>)}</g>}
    <g stroke="#776e51" strokeWidth=".6" opacity=".12">{Array.from({ length: detail.marks }, (_, i) => { const x = 474 + seed(i + 170) * 650, y = 187 + seed(i + 187) * 570; return <path key={i} d={`M${x} ${y}l${2 + seed(i + 11) * 7} ${seed(i + 19) * 2 - 1}`}/>; })}</g>
  </svg>;
}

function shotFor(scene: BloomSceneKind) {
  if (scene === "opening" || scene === "days" || scene === "pattern") return "court";
  if (scene === "songs" || scene === "artist-songs" || scene === "discoveries" || scene === "genres") return "gallery";
  if (scene === "artist" || scene === "artists") return "portrait";
  if (scene === "returns") return "tiger";
  if (scene === "finale") return "screen";
  return "alcove";
}

export default function World({ scene, stage, progress, quality, reducedMotion, view, theme, children }: BloomWorldProps) {
  const id = `korea-${useId().replace(/:/g, "")}`;
  const evening = Math.max(0, Math.min(1, progress));
  const detail = { ...tiers[quality], books: Math.min(tiers[quality].books, 3 + Math.round(evening * (tiers[quality].books - 3))) };
  const opening = scene === "opening" || view === "cover";
  const shot = view === "poster" ? "screen" : shotFor(scene);
  const style = { "--evening": evening, "--world-travel": `${(evening - .5) * 5}%`, "--world-accent": "#a76155" } as CSSProperties;
  return <div className={s.world} data-scene={scene} data-stage={stage} data-shot={shot} data-view={view} data-theme={theme} data-quality={quality} data-motion={reducedMotion || view === "poster" ? "still" : "full"} data-opening={opening} style={style}>
    <div className={s.paintedRoom} aria-hidden="true"><PaintedScreen id={id} detail={detail} quality={quality} evening={evening}/></div>
    <div className={s.eveningLight} aria-hidden="true"/>
    <Pine side="left" quality={quality} detail={detail}/><Pine side="right" quality={quality} detail={detail}/>
    <div className={s.flowerEdge} aria-hidden="true"><svg viewBox="0 0 350 500"><g transform="translate(109 474) scale(1.7)"><FlowerSpray count={detail.flowers} rich={quality >= 3}/></g><Vessel x={130} y={488} size={1.6} type={1} rich={quality >= 3}/></svg></div>
    <div className={s.magpie} key={`bird-${scene}`} aria-hidden="true"><Magpie detailed={quality >= 3}/></div>
    <div className={s.tiger} aria-hidden="true"><Tiger rich={quality >= 3}/></div>
    <div className={s.readingSpace}>
      {(opening || view === "poster") && <div className={s.drawnTitle} aria-hidden="true"><CourtyardTitle/><BloomLettering text="PAINTED COURTYARD" style="paper" className={s.titleSecond}/></div>}
      <div className={s.content}>{children}</div>
    </div>
    {!opening && <div className={s.signature} aria-hidden="true"><BloomLettering text="PAINTED COURTYARD" style="paper"/></div>}
    {detail.dust > 0 && <div className={s.paperDust} aria-hidden="true">{Array.from({ length: detail.dust }, (_, i) => <i key={i} style={{ left: `${15 + seed(i + 344) * 70}%`, top: `${12 + seed(i + 381) * 71}%`, "--delay": `${-i * .83}s`, "--float": `${8 + seed(i + 421) * 19}px`, "--size": `${1 + seed(i + 401) * 2}px` } as CSSProperties}/>)}</div>}
    {scene === "finale" && <div className={s.bojagi} aria-hidden="true">{Array.from({ length: detail.silk }, (_, i) => <i key={i} style={{ "--cloth": inks[i % inks.length], "--delay": `${i * .04}s`, "--turn": `${i % 2 ? -13 : 13}deg`, left: `${(i * 113 / detail.silk) - 7}%`, width: `${14 + seed(i + 430) * 9}%`, height: `${48 + seed(i + 448) * 36}px` } as CSSProperties}/>)}</div>}
  </div>;
}
