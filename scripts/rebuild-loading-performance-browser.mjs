/** Production bundles and controlled synthetic APIs; cold/warm runs with provenance. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from '@playwright/test';
import 'dotenv/config';
import {performanceCatalog,installPerformanceFixture,installPerformanceObservers,performanceSnapshot,feedReady,validatePerformanceFixture} from './fixtures/performance-browser.mjs';
const origin=process.env.SAKURA_TEST_URL||'http://127.0.0.1:3117';
const account={id:'90000000-0000-4000-8000-000000000087',username:'Loading performance fixture'},catalog=performanceCatalog({count:12});
const count=Number(process.env.SAKURA_PERFORMANCE_SAMPLES||3),cpuRate=Number(process.env.SAKURA_PERFORMANCE_CPU_RATE||1);
assert.ok(Number.isInteger(count)&&count>0&&count<=20);assert.ok([1,4,6].includes(cpuRate));
const output=process.env.SAKURA_PERFORMANCE_OUTPUT||'.local/continuation-loading-performance';await fs.mkdir(output,{recursive:true});
const buildId=(await fs.readFile('.next/BUILD_ID','utf8')).trim();
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={scope:'Actual production Home bundles, local generated audio/artwork and signed synthetic account; all APIs intercepted, unexpected requests rejected. Laboratory elapsed times include automation and machine load; no physical phone or deployed latency claim.',buildId,cpuRate,fixture:validatePerformanceFixture(),runs:[],errors:[]};
try{
 for(let sample=0;sample<count;sample++){
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,serviceWorkers:'block'});
  await context.addInitScript(installPerformanceObservers);
  const fixture=await installPerformanceFixture(context,{origin,account,catalog});
  const page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',error=>report.errors.push(error.message));
  if(cpuRate!==1){const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:cpuRate});}
  for(const state of ['cold','warm']){
   const before=fixture.requests.length;
   await page.goto(origin+'/home',{waitUntil:'domcontentloaded',timeout:90000});await feedReady(page,{tracks:catalog.tracks});
   const readyMs=await page.evaluate(()=>performance.now());await page.waitForTimeout(500);
   const measurement=await performanceSnapshot(page),requests=fixture.requests.slice(before);
   const stylesheetCompositions=await page.evaluate(()=>Array.from(document.styleSheets,sheet=>{
    try{const css=Array.from(sheet.cssRules,rule=>rule.cssText).join('\n');return {path:sheet.href?new URL(sheet.href).pathname:null,player:css.includes('fullPlayer'),lyrics:css.includes('lyricLines'),share:css.includes('shareGrid'),commonDialog:css.includes('gardenNote')&&css.includes('noteTuck')&&!css.includes('sleeveUnfold')};}
    catch{return {path:sheet.href,unreadable:true};}
   }));
   const journeys=await page.evaluate(()=>window.__sakuraClientMetrics?.()||[]);
   assert.equal(measurement.fit,true);assert.ok(measurement.javascript.decodedBytes>0);
   assert.deepEqual(fixture.unexpected,[]);
   if(state==='cold'){assert.equal(requests.filter(r=>r.path==='/api/v2/feed').length,1);assert.equal(requests.filter(r=>r.path==='/api/v2/feed/hero').length,0);}
   report.runs.push({sample,state,readyMs,...measurement,stylesheetCompositions,journeys,apiRequests:requests});
  }
  if(sample===0)await page.screenshot({path:output+'/home.png'});
  await context.close();
 }
 assert.deepEqual(report.errors,[]);
 const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1];
 report.distributions=Object.fromEntries(['cold','warm'].map(state=>{const values=report.runs.filter(run=>run.state===state).map(run=>run.readyMs);return [state,{samples:values.length,p50:percentile(values,.5),p95:percentile(values,.95)}];}));
 await fs.writeFile(output+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({buildId,cpuRate,distributions:report.distributions,errors:report.errors},null,2));
}finally{await browser.close();}
