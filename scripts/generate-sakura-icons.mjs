/** Rasterize the original SVG drawing; no external artwork or image service. */
import fs from "node:fs/promises";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {chromium} from "@playwright/test";
import {Blossom} from "../src/rebuild/app/Brand.tsx";

const flower=renderToStaticMarkup(React.createElement(Blossom,{style:{color:"#446b57"}}))
 .replace("<svg ",'<svg x="18" y="18" width="64" height="64" ');
const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="Sakura"><defs><radialGradient id="paper"><stop stop-color="#faf9f1"/><stop offset="1" stop-color="#f0f0e5"/></radialGradient></defs><rect width="100" height="100" fill="url(#paper)"/><circle cx="50" cy="50" r="36.5" fill="#d5ada8" opacity=".13"/><circle cx="50" cy="50" r="36.5" fill="none" stroke="#446b57" stroke-width=".3" opacity=".2"/>${flower}<g fill="none" stroke="#446b57" stroke-linecap="round" opacity=".5"><path d="M39 83Q50 79 61 83" stroke-width=".45"/><path d="M45 86Q50 84 55 86" stroke-width=".3"/></g></svg>`;
await fs.writeFile("public/icons/ink.svg",svg+"\n");
await fs.writeFile("public/favicon.svg",svg+"\n");
const browser=await chromium.launch({channel:"chrome",headless:true});
try{
 const page=await browser.newPage();
 for(const size of [180,192,512]){
  await page.setViewportSize({width:size,height:size});
  await page.setContent(`<style>html,body{margin:0;width:100%;height:100%}body>svg{display:block;width:100%;height:100%}</style>${svg}`);
  await page.screenshot({path:`public/icons/ink-${size}.png`,omitBackground:false});
 }
}finally{await browser.close();}
console.log("Generated detailed Sakura SVG, favicon, and 180/192/512px mask-safe icons.");
