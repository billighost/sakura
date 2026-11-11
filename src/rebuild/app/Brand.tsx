import type { CSSProperties } from "react";

/** The split tip, folded edges and fine veins are the shape of a cherry petal. */
export const sakuraPetalPath = "M0 4C-7-1-21-10-23-24C-25-34-18-42-9-42C-5-42-2-38 0-35C2-38 5-42 9-42C18-42 25-34 23-24C21-10 7-1 0 4Z";
export const sakuraPetalVeins = "M0 1Q-3-15 0-32M-1-13Q-10-22-15-28M1-13Q10-22 15-28M-1-21Q-7-29-9-35M1-21Q7-29 9-35";

export function Blossom({className="",style}:{className?:string;style?:CSSProperties}) {
 return <svg className={className} style={style} viewBox="0 0 100 100" aria-hidden="true" focusable="false" data-sakura-mark>
  <g transform="translate(50 50) scale(.96)">
   {[0,72,144,216,288].map(angle=><g key={angle} transform={`rotate(${angle})`}>
    <path d={sakuraPetalPath} fill="currentColor"/>
    <path d="M0 4C-7-1-21-10-23-24C-25-34-18-42-9-42C-16-33-12-14 0 4Z" fill="var(--ink-bg,#f5f5ee)" opacity=".2"/>
    <path d="M0 4C7-1 21-10 23-24C25-34 18-42 9-42C16-33 12-14 0 4Z" fill="var(--ink-text,#273b34)" opacity=".11"/>
    <path d={sakuraPetalVeins} fill="none" stroke="var(--ink-bg,#f5f5ee)" strokeWidth=".85" strokeLinecap="round" opacity=".54"/>
   </g>)}
   <circle r="10" fill="var(--ink-bg,#f5f5ee)" opacity=".3"/>
   <g stroke="var(--ink-bg,#f5f5ee)" strokeWidth=".9" strokeLinecap="round">
    {Array.from({length:15},(_,i)=><g key={i} transform={`rotate(${i*24+8})`}><path d={`M0-2Q${i%2?2:-2}-6 0-${i%3===0?13:10}`}/><circle cy={i%3===0?-13:-10} r="1.35" fill="var(--ink-bg,#f5f5ee)" stroke="none"/></g>)}
   </g>
   <circle r="3.6" fill="var(--ink-bg,#f5f5ee)"/>
   <circle r="1.45" fill="currentColor" opacity=".75"/>
  </g>
 </svg>;
}

/** A companion botanical drawing for the quiet corners of Sakura. */
export function Branch({className=""}:{className?:string}) {
 const flowers=[[458,103,.47,-8],[343,57,.38,20],[337,248,.44,-20],[574,168,.36,15],[440,184,.32,6],[503,273,.37,-16],[388,136,.28,7],[378,93,.23,25],[535,231,.25,-15],[347,211,.25,-20]];
 return <svg viewBox="0 0 620 430" className={className} aria-hidden="true" focusable="false">
  <g fill="none" stroke="currentColor" strokeLinecap="round">
   <path pathLength="1" d="M465 462C442 333 502 204 458 103C460 173 404 224 337 248M474 311C513 280 552 250 578 163M456 187C394 155 359 109 343 51" strokeWidth="2.6"/>
   <path d="M470 428C460 370 480 304 471 250M444 185Q408 166 388 136M370 96Q369 75 378 62M356 225Q348 210 347 189M531 242Q536 216 533 194M503 277Q500 255 510 238M458 122Q476 111 482 90" strokeWidth=".8" opacity=".6"/>
  </g>
  {flowers.map(([x,y,scale,angle],i)=><g key={i} transform={`translate(${x} ${y}) rotate(${angle}) scale(${scale})`}><g fill="var(--ink-petal,#d5ada8)">{[0,72,144,216,288].map(r=><g key={r} transform={`rotate(${r})`}><path d={sakuraPetalPath}/><path d={sakuraPetalVeins} fill="none" stroke="currentColor" strokeWidth=".7" opacity=".28"/></g>)}</g><g stroke="currentColor" strokeWidth=".8" opacity=".6">{[0,60,120,180,240,300].map(r=><g key={r} transform={`rotate(${r})`}><path d="M0 0 0-10"/><circle cy="-10" r="1.8" fill="currentColor"/></g>)}</g><circle r="3" fill="currentColor"/></g>)}
  <g fill="var(--ink-petal,#d5ada8)"><path d="M105 294Q98 264 118 253Q114 279 105 294M269 141Q265 120 279 113Q283 135 269 141M529 66Q520 44 537 36Q544 58 529 66"/></g>
 </svg>;
}
