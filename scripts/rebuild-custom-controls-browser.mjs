/** Custom combobox and real native range input behavior; no API/DB mutations. */
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import "dotenv/config";
import { encode } from "next-auth/jwt";

const base=process.env.SAKURA_TEST_URL||"http://localhost:3000";
const secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;
assert.ok(secret,"Auth signing configuration is required for the isolated fixture");
const token=await encode({token:{id:"90000000-0000-4000-8000-000000000098",name:"Controls fixture"},secret,salt:"authjs.session-token"});
const dir="src/app/controls-check",file=dir+"/page.tsx";
assert.equal(await fs.stat(file).then(()=>true,()=>false),false,"Do not overwrite an existing fixture");
await fs.mkdir(dir,{recursive:true});await fs.copyFile("scripts/fixtures/custom-controls-room.tsx",file);
let browser;
const checks=[],errors=[];
try {
 browser=await chromium.launch({channel:"chrome",headless:true});
 for(const mobile of [false,true]) {
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900},hasTouch:mobile,isMobile:mobile,serviceWorkers:"block"});
  await context.addCookies([{name:"authjs.session-token",value:token,url:base}]);
  const page=await context.newPage();page.on("pageerror",error=>errors.push(error.message));
  await page.goto(base+"/controls-check",{waitUntil:"domcontentloaded",timeout:120000});
  await page.locator('main[data-hydrated="true"]').waitFor({timeout:120000});
  const color=page.getByRole("combobox",{name:"Paper color",exact:true});await color.waitFor({timeout:120000});
  await color.focus();await color.press("ArrowDown");await expect(page.getByRole("listbox",{name:"Paper color"})).toBeVisible();
  await color.press("End");await color.press("Enter");await expect(page.locator("[data-color]")).toHaveText("dark");
  await color.press("Home");await color.press("Enter");await expect(page.locator("[data-color]")).toHaveText("light");
  await color.press("d");await expect(color).toHaveAttribute("aria-expanded","true");await expect(page.locator("[data-color]")).toHaveText("light");await color.press("Enter");await expect(page.locator("[data-color]")).toHaveText("dark");
  await color.click();await color.press("ArrowUp");await color.press("Escape");await expect(color).toHaveAttribute("aria-expanded","false");await expect(page.locator("[data-color]")).toHaveText("dark");
  await color.click();await page.getByRole("button",{name:"Outside choices",exact:true}).click();await expect(color).toHaveAttribute("aria-expanded","false");
  await color.click();await color.press("Tab");await expect(color).toHaveAttribute("aria-expanded","false");
  checks.push((mobile?"Mobile":"Desktop")+" combobox supports arrows, Home/End, disabled choices, typeahead, Enter, Escape, Tab and outside dismissal");
  await page.getByRole("button",{name:"Open paper dialog"}).click();const inside=page.getByRole("combobox",{name:"Dialog ink",exact:true});await inside.click();
  const popup=page.getByRole("listbox",{name:"Dialog ink"});await expect(popup).toBeVisible();const popbox=await popup.boundingBox();assert.ok(popbox&&popbox.x>=0&&popbox.x+popbox.width<= (mobile?390:1280));
  await inside.press("Escape");await expect(page.locator("dialog")).toBeVisible();await inside.click();await page.getByRole("option",{name:"Warm paper"}).click();await expect(page.locator("[data-color]")).toHaveText("warm");await page.getByRole("button",{name:"Close paper dialog"}).click();
  checks.push((mobile?"Mobile":"Desktop")+" top-layer choices remain selectable inside an overflow-clipped native dialog; Escape leaves the dialog open");
  const seek=page.getByRole("slider",{name:"Playback position",exact:true}),box=await seek.boundingBox();assert.ok(box&&box.height>=44);
  await seek.focus();await seek.press("ArrowRight");await expect(page.locator("[data-position]")).toHaveText("15000");await seek.press("Shift+ArrowRight");await expect(page.locator("[data-position]")).toHaveText("16000");
  await seek.press("Home");await expect(page.locator("[data-position]")).toHaveText("0");await seek.press("End");await expect(page.locator("[data-position]")).toHaveText("180000");
  const before=Number(await page.locator("[data-commits]").textContent());await page.mouse.move(box.x+box.width*.25,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width*.72,box.y+box.height/2,{steps:9});assert.equal(Number(await page.locator("[data-commits]").textContent()),before);await page.mouse.up();await expect(page.locator("[data-commits]")).toHaveText(String(before+1));assert.ok(Number(await page.locator("[data-position]").textContent())>110000);
  for(const name of ["Control volume","Garden intensity"]){const slider=page.getByRole("slider",{name,exact:true});assert.ok((await slider.boundingBox()).height>=44);await slider.fill("0.2");await expect(slider).toHaveValue("0.2");}
  checks.push((mobile?"Mobile":"Desktop")+" seek/volume/garden targets >=44px; scrub previews commit once; seek keys use 5s/1s increments and Home/End");
  await page.getByRole("combobox",{name:"Many choices"}).click();const many=page.getByRole("listbox",{name:"Many choices"});const manybox=await many.boundingBox();assert.ok(manybox&&manybox.y>=0&&manybox.y+manybox.height<=(mobile?844:900));
  await expect.poll(()=>many.evaluate(element=>element.scrollHeight>element.clientHeight)).toBe(true);
  if(mobile){
   const cdp=await context.newCDPSession(page),x=manybox.x+manybox.width/2,y=manybox.y+manybox.height-35;
   await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x,y}]});
   for(let step=1;step<=10;step++)await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x,y:y-step*20}]});
   await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});await cdp.detach();
  }else{await page.mouse.move(manybox.x+manybox.width/2,manybox.y+manybox.height/2);await page.mouse.wheel(0,450);}
  await expect.poll(()=>many.evaluate(element=>element.scrollTop)).toBeGreaterThan(100);
  await expect(page.getByRole("combobox",{name:"Many choices"})).toHaveAttribute("aria-expanded","true");
  checks.push((mobile?"Mobile touch":"Desktop wheel")+" scrolls long choice lists without dismissing them");
  await fs.mkdir(".local",{recursive:true});await page.screenshot({path:".local/controls-"+(mobile?"mobile":"desktop")+".png",fullPage:true});await context.close();
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({checks,pageErrors:errors}));
} finally {await browser?.close();await fs.rm(file,{force:true});await fs.rmdir(dir).catch(()=>{});}
