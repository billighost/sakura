/** Deterministic browser regression for paged search append, dedupe and stale-response guards. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

const base=process.env.SAKURA_TEST_URL||"http://127.0.0.1:3002";
if(new URL(base).hostname!=="127.0.0.1"||!["3002","3003"].includes(new URL(base).port))throw new Error("Search browser regression is restricted to isolated localhost ports 3002/3003.");
const fixture=JSON.parse(await fs.readFile(".local/rebuild-test-account.json","utf8"));
const track=(provider,id,title,versionLabel="Original recording")=>({reference:{provider,id},references:[{provider,id}],metadata:{title,artists:["Rihanna"],artistsComplete:true,durationMs:220000},artistId:"deezer:1",albumId:"deezer:2",albumTitle:"ANTI",versionLabel});
const pageBody=(tracks,next,total=tracks.length)=>({query:"",tracks,artists:[],albums:[],totals:{tracks:total,artists:0,albums:0},nextCursors:{tracks:next,artists:null,albums:null}});

const browser=await chromium.launch({channel:"chrome",headless:true});
const context=await browser.newContext({viewport:{width:1280,height:820},reducedMotion:"reduce",serviceWorkers:"block"});
await context.addCookies(fixture.cookie.split("; ").map(part=>{const index=part.indexOf("=");return{name:part.slice(0,index),value:part.slice(index+1),url:base};}));
await context.addInitScript(()=>{
 sessionStorage.setItem("sakura-ink-opening","1");
 window.__nativeSakuraIntersectionObserver=window.IntersectionObserver;
 class ManualIntersectionObserver {observe(){}unobserve(){}disconnect(){}takeRecords(){return [];}root=null;rootMargin="0px";thresholds=[];}
 Object.defineProperty(window,"IntersectionObserver",{value:ManualIntersectionObserver,configurable:true});
});
const requests=[];
const page=await context.newPage();
page.on("pageerror",error=>console.error("PAGEERROR",error.message));
page.on("console",message=>{if(message.type()==="error")console.error("CONSOLE",message.text());});
await page.route("**/api/v2/search?**",async route=>{
 const url=new URL(route.request().url()),query=url.searchParams.get("q")||"",cursor=url.searchParams.get("cursor");requests.push({query,cursor,kind:url.searchParams.get("kind")});
 if(query==="Rihanna Work"&&!cursor)return route.fulfill({json:pageBody([track("deezer","1","Work"),track("deezer","2","Work (R3hab Remix)","r3hab remix")],"1",5)});
 if(query==="Rihanna Work"&&cursor==="1")return route.fulfill({json:pageBody([track("spotify","AAAAAAAAAAAAAAAAAAAAAA","Work (R3hab Remix)","r3hab remix"),track("deezer","3","Work (Lost Kings Remix)","lost kings remix"),track("deezer","4","Work (Bad Royale Remix)","bad royale remix")],null,5)});
 if(query==="Stale"&&!cursor)return route.fulfill({json:pageBody([track("deezer","5","Stale first")],"1",2)});
 if(query==="Stale"&&cursor==="1"){await new Promise(resolve=>setTimeout(resolve,500));return route.fulfill({json:pageBody([track("deezer","6","Stale late page")],null,2)}).catch(()=>{});}
 if(query==="Tems")return route.fulfill({json:pageBody([track("deezer","7","Free Mind")],null,1)});
 if(query==="Auto"&&!cursor)return route.fulfill({json:pageBody([track("deezer","8","Auto first")],"1",2)});
 if(query==="Auto"&&cursor==="1")return route.fulfill({json:pageBody([track("deezer","9","Auto second")],null,2)});
 return route.fulfill({json:pageBody([],null,0)});
});

try{
 await page.goto(base+"/search?q="+encodeURIComponent("Rihanna Work"),{waitUntil:"domcontentloaded",timeout:90000});
 await page.getByRole("textbox",{name:"Search music",exact:true}).waitFor({timeout:60000});
 const more=page.getByRole("button",{name:"Show more results",exact:true});await expect(more).toBeVisible();await more.focus();await page.keyboard.press("Enter");
 await expect(page.locator('[data-song-id="deezer:4"]')).toBeVisible();
 await expect(page.locator('[data-song-id="deezer:2"]')).toHaveCount(1);await expect(page.locator("#music-main")).toContainText("Showing 4 from about 5 catalog matches.");
 assert.equal(requests.filter(request=>request.query==="Rihanna Work"&&request.cursor==="1"&&request.kind==="tracks").length,1);
 const input=page.getByRole("textbox",{name:"Search music",exact:true});await input.fill("Stale");await expect(page.locator('[data-song-id="deezer:5"]')).toBeVisible();await page.getByRole("button",{name:"Show more results",exact:true}).click();await input.fill("Tems");await expect(page.locator('[data-song-id="deezer:7"]')).toBeVisible();await page.waitForTimeout(650);
 await expect(page.locator('[data-song-id="deezer:6"]')).toHaveCount(0);await expect(page.locator('[data-song-id="deezer:5"]')).toHaveCount(0);
 await page.evaluate(()=>Object.defineProperty(window,"IntersectionObserver",{value:window.__nativeSakuraIntersectionObserver,configurable:true}));await input.fill("Auto");await expect(page.locator('[data-song-id="deezer:9"]')).toBeVisible();
 assert.equal(requests.filter(request=>request.query==="Auto"&&request.cursor==="1").length,1);
 console.log(JSON.stringify({status:"passed",requests,checks:["keyboard continuation","automatic scroll continuation","cross-page strict dedupe","visible result count","stale page ignored"]}));
}finally{await browser.close();}
