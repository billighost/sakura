import { useId } from "react";

// Drawn strokes, deliberately independent of installed display fonts.
const glyphs: Record<string, string> = {
 A:"M3 44 18 3 33 44M9 29H27",B:"M5 44V4H19Q34 4 30 17Q28 24 7 24M8 24H21Q36 25 31 38Q28 44 5 44",C:"M32 9Q17-5 6 10Q-1 25 7 38Q17 50 32 39",D:"M5 44V4H15Q37 5 34 26Q32 44 5 44",E:"M31 4H5V44H32M5 24H26",F:"M31 4H5V44M5 23H26",G:"M32 10Q18-4 6 10Q-1 26 8 39Q22 50 33 37V26H21",H:"M5 4V44M31 4V44M5 23H31",I:"M7 4H29M18 4V44M6 44H30",J:"M12 4H31M27 4V32Q28 49 12 44Q5 42 4 35",K:"M5 4V44M32 4 6 28M17 19 33 44",L:"M5 4V44H32",M:"M3 44V4L18 28 33 4V44",N:"M5 44V4L31 44V4",O:"M18 3Q1 3 2 24Q1 45 18 45Q35 45 34 24Q35 3 18 3Z",P:"M5 44V4H20Q34 4 32 17Q30 26 5 25",Q:"M18 3Q1 3 2 24Q1 45 18 45Q35 45 34 24Q35 3 18 3ZM21 34 36 48",R:"M5 44V4H20Q34 4 32 17Q30 26 5 25M19 25 34 44",S:"M31 9Q21-1 9 6Q-3 16 16 23Q38 29 29 41Q16 51 3 39",T:"M1 4H35M18 4V44",U:"M5 4V29Q4 45 18 45Q33 45 31 29V4",V:"M3 4 18 44 33 4",W:"M1 4 9 44 18 19 27 44 35 4",X:"M4 4 32 44M32 4 4 44",Y:"M3 4 18 24 33 4M18 24V44",Z:"M4 4H32L4 44H32",
 "0":"M18 3Q2 4 4 25Q3 45 18 45Q34 45 32 24Q34 3 18 3Z", "1":"M9 12 20 4V44M9 44H30", "2":"M4 12Q9-1 24 5Q39 14 19 28L4 44H32", "3":"M4 7Q32-3 31 15Q29 23 17 24Q37 22 32 37Q26 50 4 40", "4":"M27 44V3L3 30H35", "5":"M32 4H7L5 23Q34 13 32 34Q29 50 4 40", "6":"M30 6Q5-5 4 29Q3 47 20 44Q37 41 29 26Q16 16 5 30", "7":"M3 4H33L12 44", "8":"M18 3Q0 3 5 17Q8 24 18 24Q36 23 32 9Q29 3 18 3ZM18 24Q-2 24 5 39Q9 49 25 44Q42 35 27 26Z", "9":"M31 21Q30 1 15 4Q-1 7 5 22Q12 35 31 21Q33 47 6 44", ".":"M17 42H19", "-":"M7 25H29", "&":"M32 44 9 20Q-2 9 13 4Q28 2 22 14L8 29Q-3 44 13 45Q27 46 33 25"
};

export function BloomLettering({ text, className, style="brush", label=text }: { text:string; className?:string; style?:"brush"|"paper"|"glass"|"deco"; label?:string }) {
 const id=useId().replace(/:/g,"");
 const letters=[...text.toUpperCase()];const width=letters.reduce((n,c)=>n+(c===" "?22:43),0)+8;
 let x=4;
 return <svg className={className} viewBox={`0 0 ${width} 54`} role="img" aria-label={label} data-lettering={style} style={{overflow:"visible"}}>
  <defs><linearGradient id={`letter-${id}`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="currentColor"/><stop offset=".6" stopColor="currentColor" stopOpacity=".85"/><stop offset="1" stopColor="currentColor"/></linearGradient></defs>
  {letters.map((character,index)=>{const position=x;x+=character===" "?22:43;return character===" "?null:<g key={index} transform={`translate(${position} 0) rotate(${style==="brush"?(index%3-1)*.65:0} 18 24)`} data-letter={index}><path d={glyphs[character]||glyphs.O} fill="none" stroke={`url(#letter-${id})`} strokeWidth={style==="brush"?4.4:style==="glass"?5:2.2} strokeLinecap={style==="paper"?"square":"round"} strokeLinejoin="round"/>{style==="glass"&&<path d={glyphs[character]||glyphs.O} fill="none" stroke="var(--world-accent,#cf9b6b)" strokeWidth="1.5" strokeLinecap="round"/>}{style==="deco"&&<path d={glyphs[character]||glyphs.O} transform="translate(2 0)" fill="none" stroke="currentColor" strokeOpacity=".35" strokeWidth=".8"/>}</g>;})}
 </svg>;
}
