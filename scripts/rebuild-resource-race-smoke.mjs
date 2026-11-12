import assert from 'node:assert/strict';import {chromium,expect} from '@playwright/test';import {readFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext(),fixture=JSON.parse(await readFile('.local/rebuild-test-account.json','utf8'));
await context.addCookies(fixture.cookie.split('; ').map(value=>{const i=value.indexOf('=');return{name:value.slice(0,i),value:value.slice(i+1),url:'http://127.0.0.1:3002'};}));
const page=await context.newPage();let indexCalls=0,patchCalls=0,newData=false;let release;const blocked=new Promise(resolve=>release=resolve);
const account={id:'90000000-0000-4000-8000-000000000021',username:'review_resource',email:'resource@example.invalid'};
await page.addInitScript(()=>sessionStorage.setItem('sakura-ink-opening','1'));
await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;
 if(path==='/api/v2/library/state')return route.fulfill({json:{favoriteStates:{}}});if((path==='/api/v2/bootstrap'||path==='/api/v2/profile'))return route.fulfill({json:{profile:account}});
 if(path==='/api/v2/settings'){if(route.request().method()==='PATCH'){patchCalls++;newData=true;}return route.fulfill({json:{theme:'dark',privateSession:true,reducedMotion:true,onboarded:true,seedArtists:[],seedGenres:[]}});}
 if(path==='/api/v2/library')return route.fulfill({json:{recordings:[]}});
 if(path==='/api/v2/bloom'){const fresh=newData;indexCalls++;if(indexCalls===1)await blocked;return route.fulfill({json:{items:[{id:'weekly-review-race',period:'weekly',periodStart:'2026-10-26T00:00:00+01:00',periodEnd:'2026-11-02T00:00:00+01:00',publishAt:'2026-11-02T00:00:00+01:00',expiresAt:'2026-11-08T00:00:00+01:00',timeZone:'Africa/Lagos',status:'available',chapterCount:1,teaser:fresh?'NEW server snapshot':'OLD server snapshot'}],schedule:{timeZone:'Africa/Lagos'}}});}
 return route.fulfill({json:{}});
});
try{
 await page.goto('http://127.0.0.1:3002/bloom',{waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:/The songs you hear/}).waitFor();await expect.poll(()=>indexCalls).toBeGreaterThan(0);
 await page.getByRole('button',{name:'Change appearance',exact:true}).click();await expect.poll(()=>patchCalls).toBeGreaterThan(0);await page.waitForTimeout(100);release();
 await page.getByRole('link',{name:'Open this Bloom',exact:true}).waitFor();await page.waitForTimeout(150);
 const oldSnapshotVisible=await page.getByText('OLD server snapshot',{exact:true}).count(),newSnapshotVisible=await page.getByText('NEW server snapshot',{exact:true}).count();
 assert.equal(indexCalls,2);assert.equal(patchCalls,1);assert.equal(oldSnapshotVisible,0);assert.equal(newSnapshotVisible,1);
 console.log(JSON.stringify({scope:'intercepted synthetic API; no account/database writes',indexCalls,patchCalls,oldSnapshotVisible,newSnapshotVisible}));
}finally{release();await context.close();await browser.close();}
