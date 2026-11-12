/** Full Next UI with synthetic auth and intercepted account data; no real writes. */
import "dotenv/config";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {chromium,webkit} from "@playwright/test";
import {encode} from "next-auth/jwt";

const base=process.env.SAKURA_TEST_URL||"http://localhost:3012";
const secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;
assert.ok(secret,"Synthetic auth signing configuration is required");
const account={id:"90000000-0000-4000-8000-000000000093",username:"Opening review",email:"opening@example.invalid"};
const token=await encode({token:{id:account.id,name:account.username},secret,salt:"authjs.session-token"});
const routeDirectory="src/app/(music)/opening-art-check",routePath=routeDirectory+"/page.tsx";
assert.equal(await fs.stat(routePath).then(()=>true,()=>false),false,"Do not overwrite an existing fixture");
await fs.mkdir(routeDirectory,{recursive:true});
await fs.writeFile(routePath,'export default function Page(){return <section><h1>Opening art review</h1><p>Your music loads while the tree unfolds.</p></section>;}\n');
const output=".local/opening-art-review";
await fs.mkdir(output,{recursive:true});
const engine=process.env.SAKURA_OPENING_BROWSER||"chromium";
const browser=engine==="webkit"?await webkit.launch({headless:true}):await chromium.launch({channel:"chrome",headless:true});
const checks=[],errors=[];
const selected=process.env.SAKURA_OPENING_VIEWPORTS?.split(",");
try{
 for(const [label,width,height] of [["desktop",1440,1000],["phone",390,844],["compact-phone",320,740],["landscape",844,390],["dark",1280,900]]){
  if(selected&&!selected.includes(label))continue;
  const context=await browser.newContext({viewport:{width,height},reducedMotion:"no-preference",serviceWorkers:"block"});
  await context.addCookies([{name:"authjs.session-token",value:token,url:base}]);
  await context.route("**/api/**",async route=>{
   const path=new URL(route.request().url()).pathname;
   if(path==='/api/v2/library/state')return route.fulfill({json:{favoriteStates:{}}});if((path==="/api/v2/bootstrap"||path==="/api/v2/profile"))return route.fulfill({json:{profile:account}});
   if(path==="/api/auth/session")return route.fulfill({json:{user:account}});
   if(path==="/api/v2/settings")return route.fulfill({json:{theme:label==="dark"?"dark":"light",audioTechnology:"none",privateSession:true,reducedMotion:false,openingAnimation:1,onboarded:true,seedArtists:[],seedGenres:[],volume:.8}});
   if(path==="/api/v2/listening-session")return route.fulfill({json:{session:null,serverTime:Date.now()}});
   return route.fulfill({json:{recordings:[],items:[],likedIds:[],feedback:[],history:[]}});
  });
  const page=await context.newPage();page.on("pageerror",error=>errors.push(`${label}: ${error.message}`));
  await page.goto(base+"/opening-art-check",{waitUntil:"domcontentloaded",timeout:90000});
  await page.getByRole("heading",{name:"Opening art review",exact:true}).waitFor({timeout:60000});
  const opening=page.getByRole("status",{name:"Sakura opening",exact:true});
  async function replay(time){
   for(let attempt=0;attempt<3;attempt++){
    try{
     await page.evaluate(()=>window.dispatchEvent(new Event("sakura-replay-opening")));
     await opening.waitFor({state:"visible",timeout:5000});
     if(time!==undefined)await opening.evaluate(async(element,time)=>{
      await new Promise(resolve=>requestAnimationFrame(resolve));
      const current=document.querySelector("[data-sakura-opening]")||element;
      for(const animation of current.getAnimations({subtree:true})){animation.pause();animation.currentTime=time;}
     },time,{timeout:2500});
     return;
    }catch(error){
     if(attempt===2)throw error;
     await page.getByRole("heading",{name:"Opening art review",exact:true}).waitFor({timeout:15000});
    }
   }
  }
  await replay(1000);
  assert.equal(await opening.evaluate(el=>getComputedStyle(el).animationDuration),"4.8s");
  assert.equal(await opening.locator("[data-opening-branch]").count(),36);
  assert.equal(await opening.locator("[data-opening-flower]").count(),66);
  assert.equal(await opening.locator("[data-opening-flight]").count(),16);
  assert.ok(await opening.locator("[data-opening-branch]").first().evaluate(el=>Number.parseFloat(getComputedStyle(el).strokeDashoffset)>0));
  await page.screenshot({path:`${output}/${label}-growing.png`});
  await replay(2600);
  const art=await opening.evaluate(el=>{
   const tree=el.querySelector("[data-opening-tree]"),wind=el.querySelector("[data-opening-wind]"),field=el.querySelector("[data-opening-flight-field]"),ids=Array.from(el.querySelectorAll("[id]")).map(node=>node.id);
   const box=node=>{const b=node.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height};};
   const blossoms=el.querySelector('[class*="blossomField"]'),flowers=Array.from(el.querySelectorAll('[data-opening-flower]'));
   return {tree:box(tree),blossoms:box(blossoms),wind:box(wind),field:box(field),uniqueIds:new Set(ids).size===ids.length,nodeCount:el.querySelectorAll("*").length,branches:Array.from(el.querySelectorAll("[data-opening-branch]")).every(node=>Number.parseFloat(getComputedStyle(node).strokeDashoffset)===0),boundedFlowers:flowers.every(node=>node.tagName==='SPAN'&&node.querySelector('svg')?.getBBox().width>0&&getComputedStyle(node.querySelector('svg')).willChange.includes('transform')),maskArea:Number(el.querySelector('mask').getAttribute('width'))*Number(el.querySelector('mask').getAttribute('height'))};
  });
  assert.equal(art.uniqueIds,true,"SVG paint and shape definitions are distinct");assert.equal(art.branches,true);
  assert.equal(art.boundedFlowers,true,"Detailed blossoms grow in bounded compositor layers with valid shared SVG shapes");
  assert.ok(art.maskArea<40000,"The trunk reveal rasterizes only the painted trunk bounds");
  assert.ok(Math.abs(art.tree.x-art.blossoms.x)<.5&&Math.abs(art.tree.y-art.blossoms.y)<.5&&Math.abs(art.tree.width-art.blossoms.width)<.5&&Math.abs(art.tree.height-art.blossoms.height)<.5,`Blossoms stay aligned with the original branch coordinate space: ${JSON.stringify({tree:art.tree,blossoms:art.blossoms})}`);
  assert.ok(art.nodeCount<700,`Symbol reuse keeps animated SVG nodes bounded (${art.nodeCount})`);
  assert.equal(art.wind.width,width);assert.equal(art.wind.height,height);assert.equal(art.field.width,width);assert.equal(art.field.height,height);
  assert.ok(art.tree.width>width*.25,"Tree remains large enough on the screen");
  await page.screenshot({path:`${output}/${label}-blooming.png`});
  await replay(3900);
  const travel=await opening.locator("[data-opening-flight] svg").evaluateAll(nodes=>nodes.map(node=>({matrix:getComputedStyle(node).transform,opacity:Number(getComputedStyle(node).opacity),x:node.getBoundingClientRect().x})));
  assert.ok(travel.some(petal=>petal.opacity>.4&&petal.matrix!=="none"),"Released petals follow visible motion paths");
  assert.ok(travel.some(petal=>petal.x>width*.8),"Wind carries selected petals across the viewport");
  await page.screenshot({path:`${output}/${label}-wind.png`});
  await opening.getByRole("button",{name:"Skip",exact:true}).click();await opening.waitFor({state:"detached"});
  await replay();await page.keyboard.press("Escape");await opening.waitFor({state:"detached"});
  if(label==="desktop"){
   const started=Date.now();await replay();await opening.waitFor({state:"detached",timeout:6500});
   assert.ok(Date.now()-started>=4400,"Normal playback completes growth, bloom and wind before dismissal");
   checks.push("Complete 4.8-second introduction dismisses automatically after its full sequence");
  }
  await page.reload({waitUntil:"domcontentloaded"});await page.getByRole("heading",{name:"Opening art review",exact:true}).waitFor();await page.waitForTimeout(150);assert.equal(await opening.count(),0,"Tab reload does not replay the introduction");
  await page.emulateMedia({reducedMotion:"reduce"});
  const gentle=await page.evaluate(async()=>{
   window.dispatchEvent(new Event("sakura-replay-opening"));
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   const element=document.querySelector("[data-sakura-opening]");
   return {gentle:element?.dataset.openingGentle,wind:element?getComputedStyle(element.querySelector("[data-opening-wind]")).display:null,field:element?getComputedStyle(element.querySelector("[data-opening-flight-field]")).display:null};
  });
  assert.deepEqual(gentle,{gentle:"true",wind:"none",field:"none"});
  await opening.waitFor({state:"detached",timeout:1800});
  checks.push(`${label}: staged growth, detailed bloom, full viewport wind and detached petals; Skip, Escape, once-per-tab and reduced motion`);
  await context.close();
 }
 assert.deepEqual(errors,[]);
 const prior=selected?await fs.readFile(output+"/report.json","utf8").then(JSON.parse).catch(()=>({checks:[],errors:[]})):null;
 await fs.writeFile(output+"/report.json",JSON.stringify({checks:[...new Set([...(prior?.checks||[]),...checks])],errors},null,2));
 console.log(JSON.stringify({checks,errors}));
}finally{
 await browser.close();await fs.unlink(routePath);await fs.rmdir(routeDirectory).catch(()=>{});
}
