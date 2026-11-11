/** Regenerate bounded card assets from the original authored cinematic worlds.
 * Requires a running Next development server and Python Pillow; no account/database writes.
 * Example: SAKURA_TEST_URL=http://localhost:3012 node scripts/rebuild-bloom-covers.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {chromium} from '@playwright/test';

const base=process.env.SAKURA_TEST_URL||'http://localhost:3012';
const worlds=['sakura','jungle','disco','japan','china','korea','india','ocean','cosmos','glass'];
const themes=['light','dark'],width=960,height=720;
const routeDirectory=path.resolve('src/app/rebuild/bloom-cover-capture');
const routePath=path.join(routeDirectory,'page.tsx');
const output=path.resolve('public/bloom/covers'),source=path.resolve('.local/bloom-cover-source');
await assert.rejects(fs.access(routePath),'Refuse to overwrite an existing capture route.');
await fs.mkdir(routeDirectory,{recursive:true});await fs.mkdir(output,{recursive:true});await fs.mkdir(source,{recursive:true});
const capture=`"use client";
import {Suspense} from "react";
import {useSearchParams} from "next/navigation";
import {WorldStage} from "@/rebuild/bloom/worlds/WorldStage";
import {isBloomWorld} from "@/rebuild/bloom/worlds/registry";
function Cover(){const query=useSearchParams(),selected=query.get("world"),world=isBloomWorld(selected)?selected:"sakura",theme=query.get("theme")==="dark"?"dark":"light";return <main data-bloom-capture style={{width:${width},height:${height},overflow:"hidden",position:"relative"}}><WorldStage design={world} scene="opening" stage={0} progress={.14} quality={5} reducedMotion view="cover" theme={theme}/></main>;}
export default function Capture(){return <Suspense><Cover/></Suspense>;}
`;
await fs.writeFile(routePath,capture);
const manifest={generator:'scripts/rebuild-bloom-covers.mjs',source:'Original WorldStage opening/cover at maximum authored detail, reduced motion.',dimensions:{480:[480,360],960:[960,720]},quality:86,assets:[]};
let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1200,height:900},deviceScaleFactor:1,reducedMotion:'reduce',serviceWorkers:'block'});
 const page=await context.newPage();page.setDefaultTimeout(60000);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 for(const world of worlds)for(const theme of themes){
  for(let attempt=0;;attempt++){
   try{
    await page.goto(`${base}/rebuild/bloom-cover-capture?world=${world}&theme=${theme}`,{waitUntil:'load',timeout:120000});
    const illustration=page.locator('[data-bloom-capture]');
    await page.locator(`[data-bloom-world="${world}"] > [data-view="cover"]`).waitFor();
    await page.evaluate(()=>document.fonts.ready);
    await page.addStyleTag({content:`
     *,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}
     [data-bloom-capture] [data-view="cover"]{height:100%!important;min-height:100%!important}
     [data-bloom-world="sakura"] [class*="titleArt"]{width:min(90%,560px)!important;margin:42px auto 0!important}
    `});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await illustration.screenshot({path:path.join(source,`${world}-${theme}.png`),animations:'disabled'});break;
   }catch(error){if(attempt>=2||!/context was destroyed|navigation|interrupted/i.test(String(error)))throw error;}
  }
  const artwork=await fs.readFile(`src/rebuild/bloom/worlds/${world}/World.tsx`,'utf8'),stylesheet=await fs.readFile(`src/rebuild/bloom/worlds/${world}/world.module.css`,'utf8'),geometry=await fs.readFile('src/rebuild/bloom/worlds/stableTrig.ts','utf8');
  // Source identity stays stable across Git's Windows line-ending conversion.
  const sourceHash=createHash('sha256').update(artwork.replace(/\r\n/g,'\n')).update(stylesheet.replace(/\r\n/g,'\n')).update(geometry.replace(/\r\n/g,'\n')).digest('hex');
  manifest.assets.push({world,theme,sourceHash});
  console.log(`Captured ${world} ${theme}`);
 }
 assert.deepEqual(errors,[],'Authored covers render without page errors.');
 const convert=spawnSync(process.env.SAKURA_PYTHON||'python',['-c',
  'from PIL import Image\nfrom pathlib import Path\nimport sys,json\nsource=Path(sys.argv[1]);out=Path(sys.argv[2])\nfor world in json.loads(sys.argv[3]):\n for theme in ("light","dark"):\n  name=world+"-"+theme;image=Image.open(source/(name+".png")).convert("RGB")\n  for width in (480,960):\n   resized=image.resize((width,width*3//4),Image.Resampling.LANCZOS)\n   resized.save(out/(name+"-"+str(width)+".webp"),"WEBP",quality=86,method=6)\n',source,output,JSON.stringify(worlds)],{encoding:'utf8',windowsHide:true});
 if(convert.status!==0)throw new Error(`Pillow cover conversion failed: ${convert.stderr}`);
 let totalBytes=0;const revision=createHash('sha256');
 for(const asset of manifest.assets){
  asset.files=[];
  for(const size of [480,960]){
   const name=`${asset.world}-${asset.theme}-${size}.webp`,bytes=await fs.readFile(path.join(output,name));
   assert.ok(bytes.length<180000,`${name} exceeds the 180 KB thumbnail budget.`);
   const digest=createHash('sha256').update(bytes).digest('hex');revision.update(digest);totalBytes+=bytes.length;
   asset.files.push({path:`/bloom/covers/${name}`,width:size,height:size*3/4,bytes:bytes.length,sha256:digest});
  }
 }
 assert.ok(totalBytes<4000000,'All 40 cover variants together must remain below 4 MB.');
 manifest.totalBytes=totalBytes;manifest.revision=revision.digest('hex').slice(0,12);
 await fs.writeFile('src/rebuild/bloom/cover-manifest.json',JSON.stringify(manifest,null,2)+'\n');
 await fs.writeFile('src/rebuild/bloom/coverRevision.ts',`// Generated by scripts/rebuild-bloom-covers.mjs from the authored worlds.\nexport const BLOOM_COVER_REVISION=${JSON.stringify(manifest.revision)};\n`);
 console.log(JSON.stringify({assets:manifest.assets.length*2,totalBytes,dimensions:manifest.dimensions,revision:manifest.revision}));
}finally{
 await browser?.close();await fs.unlink(routePath);await fs.rmdir(routeDirectory);
}
