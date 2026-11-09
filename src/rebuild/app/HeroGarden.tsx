import { useId, type CSSProperties } from "react";
import s from "./hero-garden.module.css";

const petal = "M0 0C-12-6-18-22-8-29L0-23L8-29C18-22 12-6 0 0Z";

/** Original ink drawings: a sheltered flowering branch and an open blossom sky. */
export function HeroGarden({ surface }: { surface: "home" | "discover" }) {
  const id = useId().replace(/:/g, "");
  const home = surface === "home";
  const flowers = home
    ? [[333, 88, .85, -12], [399, 129, .62, 20], [284, 182, .7, -18], [390, 235, 1.02, 16], [325, 294, .58, -8], [442, 335, .7, 22], [236, 74, .45, 5]]
    : [[382, 70, .75, 16], [298, 124, .9, -18], [430, 187, .65, 8], [342, 270, 1.04, -10], [247, 331, .61, 23], [424, 350, .43, -16], [211, 78, .4, 8]];
  return <svg className={`${s.garden} ${home ? s.home : s.discover}`} viewBox="0 0 480 430" fill="none" aria-hidden="true" data-hero-garden={surface}>
    <defs><radialGradient id={`${id}-wash`}><stop stopColor="var(--ink-petal)" stopOpacity=".28"/><stop offset="1" stopColor="var(--ink-petal)" stopOpacity="0"/></radialGradient>
      <linearGradient id={`${id}-petal`} x1="-12" y1="-29" x2="9" y2="0" gradientUnits="userSpaceOnUse"><stop stopColor="var(--ink-petal)"/><stop offset="1" stopColor="var(--ink-card)"/></linearGradient></defs>
    <ellipse className={s.wash} cx={home ? 352 : 335} cy="205" rx="185" ry="210" fill={`url(#${id}-wash)`}/>
    {home ? <>
      <path className={s.ink} pathLength="1" d="M469 443C413 379 457 285 390 235C343 199 373 120 333 88C304 61 269 66 236 74M421 344C382 333 347 326 325 294M384 226C333 229 302 208 284 182M347 110C375 117 387 125 399 129"/>
      <path className={s.fineInk} pathLength="1" d="M462 427C409 364 441 295 381 249M283 182C255 155 248 136 250 117M334 88C339 57 353 38 373 30M399 130C433 126 453 111 464 88M326 294C302 300 279 290 269 269"/>
      <g className={s.leaves}><path d="M251 118C231 116 220 103 224 88C242 92 251 105 251 118Z"/><path d="M373 30C365 12 375 1 391-3C396 16 386 24 373 30Z"/><path d="M465 88C449 74 453 56 466 47C476 63 475 76 465 88Z"/><path d="M270 269C248 269 232 253 235 239C253 241 265 252 270 269Z"/></g>
    </> : <>
      <g className={s.orbits}><path className={s.orbit} pathLength="1" d="M201 350C135 288 171 175 248 111C326 46 437 47 472 114"/><path className={s.orbit} pathLength="1" d="M221 376C328 425 450 337 457 236C463 150 413 98 343 102"/><ellipse cx="333" cy="226" rx="137" ry="167" transform="rotate(28 333 226)" strokeDasharray="2 10"/></g>
      <path className={s.ink} pathLength="1" d="M237 420C244 365 309 341 342 270C362 229 346 175 298 124M343 270C382 247 412 217 430 187M299 125C337 132 363 103 382 70M247 331C228 319 216 299 207 277"/>
      <g className={s.leaves}><path d="M208 279C187 272 179 259 183 244C201 248 208 263 208 279Z"/><path d="M429 188C427 166 439 152 454 149C456 168 446 182 429 188Z"/><path d="M383 69C372 47 381 30 397 27C402 44 396 59 383 69Z"/></g>
      <g className={s.stars}>{[[193, 203], [258, 44], [458, 295], [398, 404]].map(([x, y], i) => <path key={i} d={`M${x-5} ${y}h10M${x} ${y-5}v10`} style={{ "--order": i } as CSSProperties}/>)}</g>
    </>}
    {flowers.map(([x, y, scale, angle], index) => <g key={index} transform={`translate(${x} ${y}) rotate(${angle}) scale(${scale})`}>
      <g className={s.flower} style={{ "--order": index } as CSSProperties}>{[0, 72, 144, 216, 288].map(rotation => <path key={rotation} transform={`rotate(${rotation})`} d={petal} fill={`url(#${id}-petal)`}/>)}
        <g className={s.stamens}>{[0, 60, 120, 180, 240, 300].map(rotation => <g key={rotation} transform={`rotate(${rotation})`}><path d="M0 0L0-8"/><circle cy="-8" r="1"/></g>)}<circle r="2.7"/></g>
      </g></g>)}
    {[[160, 94, -22], [223, 248, 25], [398, 20, 42], [294, 378, -35]].map(([x, y, angle], index) => <g key={index} transform={`translate(${x} ${y}) rotate(${angle})`}><path className={s.driftingPetal} style={{ "--order": index } as CSSProperties} d="M0 0C-9-9-6-20 2-23C10-15 8-5 0 0Z"/></g>)}
  </svg>;
}
