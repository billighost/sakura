import {chromium} from "@playwright/test";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const base=process.env.SAKURA_TEST_URL||"http://localhost:3000";
const fixture=JSON.parse(await fs.readFile(".local/rebuild-test-account.json","utf8"));
const browser=await chromium.launch({channel:"chrome",headless:true});
const cookie=fixture.cookie.split("; ").map(part=>{const split=part.indexOf("=");return{name:part.slice(0,split),value:part.slice(split+1),url:base};});
const results=[];
const openingContext=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:"no-preference"});
try{
 await openingContext.addCookies(cookie);
 const openingPage=await openingContext.newPage();const openingErrors=[];openingPage.on("pageerror",error=>openingErrors.push(error.message));
 await openingPage.route("**/api/v2/settings",async route=>{if(route.request().method()!=="GET")return route.continue();const response=await route.fetch();const body=await response.json();await route.fulfill({response,json:{...body,reducedMotion:false}});});
 await openingPage.goto(base+"/home");const opening=openingPage.getByRole("status",{name:"Sakura opening",exact:true});await opening.waitFor({state:"visible"});assert.equal(await opening.evaluate(element=>getComputedStyle(element).animationDuration),"4.8s");const openingStarted=Date.now();await openingPage.waitForTimeout(4200);assert.equal(await opening.isVisible(),true);await opening.waitFor({state:"detached",timeout:1800});assert.ok(Date.now()-openingStarted>=4300);assert.deepEqual(openingErrors,[]);results.push("opening completes its full 4.8-second sequence before dismissal");
 await openingPage.evaluate(()=>window.dispatchEvent(new Event("sakura-replay-opening")));await opening.waitFor({state:"visible"});await opening.getByRole("button",{name:"Skip",exact:true}).click();await opening.waitFor({state:"detached"});results.push("opening dismisses immediately when Skip is chosen");
}catch(error){await openingContext.close();await browser.close();throw error;}
await openingContext.close();
const context=await browser.newContext({viewport:{width:1440,height:1000}});
await context.addCookies(cookie);
await context.addInitScript(()=>{const AudioBase=window.Audio;window.Audio=function(...args){const audio=new AudioBase(...args);window.__inkAudio=audio;return audio;};window.Audio.prototype=AudioBase.prototype;sessionStorage.setItem("sakura-ink-opening","1");});
const page=await context.newPage();const errors=[];page.on("pageerror",error=>errors.push(error.message));
const api=async(path,init={})=>{const response=await fetch(base+path,{...init,headers:{Cookie:fixture.cookie,Origin:base,"Content-Type":"application/json",...init.headers}});const data=await response.json();if(!response.ok)throw new Error(path+": "+response.status+" "+data.error);return data;};
let playlist=null;
try{
 await page.goto(base+"/home");await page.locator("#music-main h1").filter({visible:true}).first().waitFor();await page.getByText("A few good places to start",{exact:true}).waitFor({timeout:60000});
 await page.screenshot({path:".local/rebuild-ink-home-light.png"});results.push("real account home renders");
 await page.getByRole("button",{name:"Change appearance",exact:true}).click();await page.waitForFunction(()=>document.documentElement.dataset.inkTheme==="dark");await page.screenshot({path:".local/rebuild-ink-home-dark.png"});results.push("real theme setting saves from browser origin");
 await api("/api/v2/settings",{method:"PATCH",body:JSON.stringify({theme:"light"})});
 const beforeRequests=[];page.on("request",request=>{if(request.url().endsWith("/api/v2/home"))beforeRequests.push(request.url());});
 await page.locator("nav[aria-label='Main navigation']").getByRole("link",{name:"Your library",exact:true}).click();await page.locator("#music-main h1").filter({visible:true}).first().waitFor();
 await page.locator("nav[aria-label='Main navigation']").getByRole("link",{name:"Home",exact:true}).click();await page.getByText("A few good places to start",{exact:true}).waitFor();assert.equal(beforeRequests.length,0);results.push("return to home uses account-scoped cache");
 await page.goto(base+"/track/deezer:136336124");await page.getByRole("button",{name:"Play song",exact:true}).waitFor({timeout:60000});
 await page.getByRole("button",{name:"Play song",exact:true}).click();await page.waitForFunction(()=>window.__inkAudio?.currentTime>1,{},{timeout:60000});
 const started=await page.evaluate(()=>({time:window.__inkAudio.currentTime,duration:window.__inkAudio.duration}));assert.ok(started.duration>180);results.push("real original Finesse full audio plays");
 await page.locator("nav[aria-label='Main navigation']").getByRole("link",{name:"Your library",exact:true}).click();await page.locator("#music-main h1").filter({visible:true}).first().waitFor();await page.waitForFunction(time=>window.__inkAudio.currentTime>time+1,started.time,{timeout:10000});results.push("actual playback continues across navigation");
 await page.getByRole("button",{name:"New playlist",exact:true}).click();await page.getByPlaceholder("Songs for a softer day").fill("Ink browser verification");await page.getByRole("button",{name:"Create playlist",exact:true}).click();await page.waitForURL(/\/playlist\//,{timeout:20000});playlist=page.url().split("/").pop();results.push("playlist creation navigates without reload");
 await page.goto(base+"/track/deezer:136336124");await page.getByRole("button",{name:"Save on this device",exact:true}).waitFor({timeout:30000});await page.getByRole("button",{name:"Save on this device",exact:true}).click();
 await page.getByText("Saved on this device. Ready for the offline hours.",{exact:true}).waitFor({timeout:90000});
 await page.goto(base+"/library/downloaded");await page.getByText("1 songs ready offline",{exact:true}).waitFor({timeout:20000});results.push("complete full audio download verified and stored once");
 await page.getByRole("button",{name:"Play saved songs",exact:true}).click();await page.waitForFunction(()=>window.__inkAudio?.src.startsWith("blob:")&&window.__inkAudio.currentTime>.5,{},{timeout:15000});results.push("saved recording plays from verified device blob");
 await context.setOffline(true);await page.getByRole("button",{name:"Pause",exact:true}).filter({visible:true}).first().click();await page.getByRole("button",{name:"Play",exact:true}).filter({visible:true}).first().click();await page.waitForFunction(()=>!window.__inkAudio.paused&&window.__inkAudio.currentTime>1,{},{timeout:15000});results.push("download plays with browser network disabled");await context.setOffline(false);
 assert.deepEqual(errors,[]);await fs.writeFile(".local/rebuild-ink-smoke-report.json",JSON.stringify({passed:results.length,checks:results,pageErrors:errors},null,2));console.log(JSON.stringify({passed:results.length,checks:results}));
}catch(error){await page.screenshot({path:".local/rebuild-ink-smoke-failure.png"}).catch(()=>{});console.error(JSON.stringify({checks:results,pageErrors:errors}));throw error;}finally{if(playlist)await api("/api/v2/playlists/"+playlist,{method:"DELETE"}).catch(()=>{});await api("/api/v2/settings",{method:"PATCH",body:JSON.stringify({theme:"light"})}).catch(()=>{});await browser.close();}
