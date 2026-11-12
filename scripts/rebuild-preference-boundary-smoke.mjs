import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext();const page=await context.newPage();let current='A';const patches=[],profileReads=[];
const accounts={A:{id:'90000000-0000-4000-8000-000000000011',username:'review_a',email:'a@example.invalid'},B:{id:'90000000-0000-4000-8000-000000000012',username:'review_b',email:'b@example.invalid'}};
const fixture=JSON.parse(await readFile('.local/rebuild-test-account.json','utf8'));await context.addCookies(fixture.cookie.split('; ').map(value=>{const i=value.indexOf('=');return{name:value.slice(0,i),value:value.slice(i+1),url:'http://127.0.0.1:3002'};}));
await page.addInitScript(()=>sessionStorage.setItem('sakura-ink-opening','1'));
await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;
 if(path==='/api/v2/library/state')return route.fulfill({json:{favoriteStates:{}}});if((path==='/api/v2/bootstrap'||path==='/api/v2/profile')){profileReads.push(current);return route.fulfill({json:{profile:accounts[current]}});}
 if(path==='/api/v2/settings'){if(route.request().method()==='PATCH'){const body=route.request().postDataJSON();patches.push({account:current,accountHeader:route.request().headers()['x-sakura-account'],body});return current==='A'?route.fulfill({status:503,json:{error:'Synthetic offline save'}}):route.fulfill({json:{...body,revision:9}});}return route.fulfill({json:{theme:'dark',privateSession:false,reducedMotion:true,onboarded:true,seedArtists:[],seedGenres:[],revision:7}});}
 if(path==='/api/v2/library')return route.fulfill({json:{recordings:[]}});
 if(path==='/api/v2/bloom')return route.fulfill({json:{items:[],schedule:{timeZone:'Africa/Lagos'}}});
 return route.fulfill({json:{}});
});
try{
 await page.goto('http://127.0.0.1:3002/bloom',{waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:/The songs you hear/}).waitFor();
 await page.getByRole('button',{name:'Change appearance',exact:true}).click();await expect.poll(()=>patches.length).toBeGreaterThan(0);
 await page.waitForTimeout(100);current='B';await page.evaluate(()=>window.dispatchEvent(new Event('online')));await expect.poll(()=>profileReads.includes('B')).toBe(true);await page.waitForTimeout(1500);
 assert.equal(patches.length,1);assert.equal(patches[0].account,'A');assert.equal(patches[0].accountHeader,accounts.A.id);assert.equal('revision' in patches[0].body,false);
 console.log(JSON.stringify({scope:'fully intercepted synthetic accounts; no real database writes',patches,accountIsolation:true}));
}finally{await context.close();await browser.close();}
