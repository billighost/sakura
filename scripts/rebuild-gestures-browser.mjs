/** Native browser pointer gestures against shared production controls; isolated account and APIs. */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import 'dotenv/config';
import { encode } from 'next-auth/jwt';
import { spawn, spawnSync } from 'node:child_process';

const localDev = process.env.SAKURA_GESTURE_DEV === '1';
const base = process.env.SAKURA_TEST_URL || (localDev ? 'http://127.0.0.1:3018' : 'http://localhost:3000');
const account = {id:'90000000-0000-4000-8000-000000000097',username:'Gesture fixture',email:'gestures@example.invalid'};
const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
assert.ok(secret, 'An isolated signed browser session requires the existing auth configuration.');
const token = await encode({token:{id:account.id,name:account.username},secret,salt:'authjs.session-token'});
const routeDir = 'src/app/(music)/gesture-check', routePath = routeDir + '/page.tsx';
assert.equal(await fs.stat(routePath).then(() => true, () => false), false);
await fs.mkdir(routeDir,{recursive:true});await fs.copyFile('scripts/fixtures/gesture-room.tsx',routePath);
const checks = [], errors = [];
let page, browser, server;
const buildDir = `.local/next-gestures-${process.pid}`;
try {
  if (localDev) {
    server = spawn(process.execPath,['scripts/run-next.mjs','dev','--hostname','127.0.0.1','--port',new URL(base).port],{stdio:'inherit',windowsHide:true,env:{...process.env,SAKURA_BUILD_DIR:buildDir}});
    const deadline = Date.now() + 120000;
    while (true) {
      if (server.exitCode !== null) throw new Error('Isolated gesture verification server exited before it was ready.');
      if (await fetch(base+'/login',{signal:AbortSignal.timeout(2500)}).then(r=>r.ok,()=>false)) break;
      if (Date.now()>deadline) throw new Error('Isolated gesture verification server did not become ready.');
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
  }
  browser = await chromium.launch({channel:'chrome',headless:true});
  for (const reduced of [false,true]) {
    const context = await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:reduced?'reduce':'no-preference',serviceWorkers:'block'});
    await context.addCookies([{name:'authjs.session-token',value:token,url:base}]);
    await context.addInitScript(() => sessionStorage.setItem('sakura-ink-opening','1'));
    await context.route('**/api/**',route => {
      const path = new URL(route.request().url()).pathname;
      if(path==='/api/v2/library/state')return route.fulfill({json:{favoriteStates:{}}});if ((path==='/api/v2/bootstrap'||path === '/api/v2/profile')) return route.fulfill({json:{profile:account}});
      if (path === '/api/v2/settings') return route.fulfill({json:{theme:'light',audioTechnology:'none',privateSession:true,reducedMotion:reduced,onboarded:true,openingAnimation:0,seedArtists:[],seedGenres:[]}});
      if (path === '/api/v2/listening-session') return route.fulfill({json:{session:null,serverTime:Date.now()}});
      return route.fulfill({json:{items:[],recordings:[],playlists:[]}});
    });
    page = await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',error => errors.push(error.message));
    await page.goto(base+'/gesture-check',{waitUntil:'domcontentloaded',timeout:90000});
    await page.getByRole('heading',{name:'Gesture verification'}).waitFor();
    const cdp = await context.newCDPSession(page);
    const link = page.getByRole('link',{name:'A song with options'});
    const row = page.locator('[data-song-id="gesture-fixture"]');
    async function touchStart(x,y) {await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});}
    async function touchMove(x,y) {await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y,id:1}]});}
    async function touchEnd() {await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
    async function touchDrag(locator,dx,dy,{steps=8,startX=.35,startY=.5}={}) {
      await locator.scrollIntoViewIfNeeded();const box = await locator.boundingBox();assert.ok(box);
      const x=box.x+box.width*startX,y=box.y+box.height*startY;
      await touchStart(x,y);
      for(let i=1;i<=steps;i++){await touchMove(x+dx*i/steps,y+dy*i/steps);await page.waitForTimeout(22);}
      await touchEnd();
    }
    let box = await link.boundingBox();assert.ok(box);
    await touchStart(box.x+35,box.y+30);await page.waitForTimeout(540);await touchEnd();
    await expect(page.locator('[data-options]')).toHaveText('1');await expect(page.locator('[data-clicks]')).toHaveText('0');
    await page.waitForTimeout(1050);
    await row.dispatchEvent('pointerdown',{pointerType:'touch',pointerId:21,button:0,clientX:30,clientY:30,isPrimary:true});
    await row.dispatchEvent('pointerdown',{pointerType:'touch',pointerId:22,button:0,clientX:60,clientY:30,isPrimary:false});
    await page.waitForTimeout(540);await row.dispatchEvent('pointerup',{pointerType:'touch',pointerId:21,button:0});
    await expect(page.locator('[data-options]')).toHaveText('1');
    await row.dispatchEvent('pointerdown',{pointerType:'touch',pointerId:2,button:0,clientX:30,clientY:30,isPrimary:true});
    await row.dispatchEvent('pointermove',{pointerType:'touch',pointerId:2,clientX:30,clientY:52,isPrimary:true});
    await page.waitForTimeout(540);await row.dispatchEvent('pointerup',{pointerType:'touch',pointerId:2,button:0});
    await expect(page.locator('[data-options]')).toHaveText('1');
    await link.click({button:'right'});await expect(page.locator('[data-options]')).toHaveText('2');
    await link.focus();await page.keyboard.press('Shift+F10');await expect(page.locator('[data-options]')).toHaveText('3');
    await page.keyboard.press('ContextMenu');await expect(page.locator('[data-options]')).toHaveText('4');
    const like = page.getByRole('button',{name:'Like fixture song'});box=await like.boundingBox();assert.ok(box);
    await touchStart(box.x+box.width/2,box.y+box.height/2);await page.waitForTimeout(540);await touchEnd();
    await expect(page.locator('[data-options]')).toHaveText('4');
    await like.focus();await page.keyboard.press('Shift+F10');await expect(page.locator('[data-options]')).toHaveText('4');
    const typing=page.getByRole('textbox',{name:'Gesture typing field'});box=await typing.boundingBox();assert.ok(box);
    await touchStart(box.x+box.width/2,box.y+box.height/2);await page.waitForTimeout(540);await touchEnd();
    await expect(page.locator('[data-options]')).toHaveText('4');
    checks.push({reduced,check:'link long press suppresses click; movement, editable fields and secondary controls retain ownership; mouse and keyboard options work'});
    const collectionLink=page.getByRole('link',{name:'Gesture collection'}),collectionOptions=page.getByRole('button',{name:'More options for Gesture collection'});
    await collectionOptions.click();await expect(page.getByRole('menu',{name:'Gesture collection'})).toBeVisible();
    await collectionOptions.click();await expect(page.getByRole('menu',{name:'Gesture collection'})).toHaveCount(0);
    await collectionLink.focus();await page.keyboard.press('Shift+F10');await expect(page.getByRole('menu',{name:'Gesture collection'})).toBeVisible();
    await page.keyboard.press('End');await expect(page.getByRole('menuitem',{name:'Save songs on this device'})).toBeFocused();
    await page.keyboard.press('Escape');await expect(page.getByRole('menu',{name:'Gesture collection'})).toHaveCount(0);await expect(collectionLink).toBeFocused();
    await typing.focus();await page.keyboard.press('Shift+/');await expect(page.getByRole('heading',{name:'A few little shortcuts.'})).toHaveCount(0);
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });await page.keyboard.press('Shift+/');await expect(page.getByRole('heading',{name:'A few little shortcuts.'})).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('dialog[open]')).toHaveCount(0);
    checks.push({reduced,check:'collection options toggle and restore focus; editable targets keep shortcuts; keyboard help remains discoverable'});
    const surface=page.locator('[data-swipe-surface]');
    await touchDrag(surface,-90,3);await expect(page.locator('[data-song]')).toHaveText('1');
    await page.waitForTimeout(600);await touchDrag(surface,90,3);await expect(page.locator('[data-song]')).toHaveText('0');
    await page.waitForTimeout(600);await touchDrag(surface,20,50);await expect(page.locator('[data-song]')).toHaveText('0');
    await surface.scrollIntoViewIfNeeded();box=await surface.boundingBox();assert.ok(box);
    await page.mouse.move(box.x+180,box.y+65);await page.mouse.down();await page.mouse.move(box.x+70,box.y+66,{steps:10});await page.mouse.up();
    await expect(page.locator('[data-song]')).toHaveText('1');
    checks.push({reduced,check:'native touch horizontal swipes and desktop drag change songs; vertical gestures preserve song'});
    async function noteOpen(locked=false){await page.getByRole('button',{name:locked?'Open locked note':'Open gesture note',exact:true}).click();await expect(page.locator('dialog[open]').last()).toHaveAttribute('data-dialog-phase','open',{timeout:5000});}
    async function pull(dx,dy){await touchDrag(page.locator('dialog[open]').last().locator('[data-dialog-swipe-handle]'),dx,dy,{startX:.5,startY:.12});}
    await noteOpen();
    const grip=page.locator('dialog[open] [data-dialog-swipe-handle]');box=await grip.boundingBox();assert.ok(box);
    const gripX=box.x+box.width*.5,gripY=box.y+box.height*.12;
    await touchStart(gripX,gripY);await touchMove(gripX,gripY+45);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:gripX,y:gripY+45,id:1},{x:gripX+30,y:gripY+45,id:2}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:gripX,y:gripY+150,id:1},{x:gripX+30,y:gripY+150,id:2}]});await touchEnd();
    await expect(page.locator('dialog[open]')).toHaveCount(1);
    await pull(0,24);await page.waitForTimeout(550);await expect(page.locator('dialog[open]')).toHaveCount(1);
    assert.equal(await page.locator('dialog[open]').evaluate(e=>getComputedStyle(e).translate),'none');
    const scroll=page.locator('[data-scroll-fixture]');await touchDrag(scroll,0,-130);await expect(page.locator('dialog[open]')).toHaveCount(1);
    await expect.poll(()=>scroll.evaluate(e=>e.scrollTop)).toBeGreaterThan(0);
    await page.getByRole('button',{name:'Open inner note',exact:true}).click();await expect(page.locator('dialog[open]').last()).toHaveAttribute('data-dialog-phase','open');
    await pull(0,150);await expect(page.locator('dialog[open]')).toHaveCount(1);
    await expect(page.locator('dialog[open] h2')).toHaveText('Gesture note');assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');
    await pull(0,150);await expect(page.locator('dialog[open]')).toHaveCount(0);await expect(page.locator('[data-closes]')).toHaveText('1');
    assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
    await noteOpen(true);await page.locator('dialog[open] [data-note-focus]').focus();await page.keyboard.press('Shift+/');await expect(page.locator('dialog[open]')).toHaveCount(1);await expect(page.locator('dialog[open] h2')).toHaveText('Gesture note');
    await pull(0,160);await page.waitForTimeout(550);await expect(page.locator('dialog[open]')).toHaveCount(1);
    await page.getByRole('button',{name:'Unlock note',exact:true}).click();await pull(0,150);await expect(page.locator('dialog[open]')).toHaveCount(0);
    checks.push({reduced,check:'small pulls settle; body scrolling retained; nested sheet dismisses only itself; locked dismissal respected; focus and scroll lock restored'});
    await context.close();
  }
  assert.deepEqual(errors,[]);await fs.mkdir('.local',{recursive:true});await fs.writeFile('.local/rebuild-gestures-report.json',JSON.stringify({checks,pageErrors:errors},null,2));console.log(JSON.stringify({checks,pageErrors:errors}));
} catch(error) {
  await fs.mkdir('.local',{recursive:true});await page?.screenshot({path:'.local/rebuild-gestures-failure.png'}).catch(()=>{});
  console.log(await page?.evaluate(()=>({options:document.querySelector('[data-options]')?.textContent,song:document.querySelector('[data-song]')?.textContent,dialogs:Array.from(document.querySelectorAll('dialog')).map(e=>({phase:e.dataset.dialogPhase,translate:getComputedStyle(e).translate,rect:e.getBoundingClientRect().toJSON()}))})).catch(()=>null));throw error;
} finally {
  await browser?.close();
  if(server){if(process.platform==='win32')spawnSync('taskkill',['/pid',String(server.pid),'/t','/f'],{windowsHide:true,stdio:'ignore'});else server.kill('SIGTERM');}
  await fs.rm(routePath,{force:true});await fs.rmdir(routeDir).catch(()=>{});
  if(localDev){const config=JSON.parse(await fs.readFile('tsconfig.json','utf8'));config.include=config.include.filter(entry=>!entry.startsWith(buildDir+'/'));await fs.writeFile('tsconfig.json',JSON.stringify(config,null,2)+'\n');}
}
