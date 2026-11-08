import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createOpeningSession } from "../src/rebuild/app/openingSession";

const read=(path:string)=>readFileSync(path,"utf8");

test("music routes keep an instant loading shell and page-local transition",()=>{
 const layout=read("src/app/(music)/layout.tsx"),loading=read("src/app/(music)/loading.tsx"),ux=read("src/rebuild/app/NavigationUX.tsx"),css=read("src/rebuild/app/ink.module.css");
 assert.match(layout,/RouteTransition/);
 assert.match(loading,/MusicRouteLoading/);
 assert.match(ux,/router\.prefetch\("\/home"\)|for\(const href of \["\/home"/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)[\s\S]*\.routeTransition/);
});

test("dynamic music pages do not opt out of instant navigation",()=>{
 for(const route of ["album","artist","mix","playlist","track"]){
  const source=read(`src/app/(music)/${route}/[id]/page.tsx`);
  assert.doesNotMatch(source,/instant\s*=\s*false/,`${route} should use the shared loading shell`);
 }
});

test("the root recovery link uses client navigation",()=>{
 const source=read("src/app/global-error.tsx");
 assert.match(source,/import Link from "next\/link"/);
 assert.doesNotMatch(source,/<a href="\/offline"/);
});

test("welcome is claimed only once while ordinary components remount",()=>{
 const saved=new Map<string,string>();
 const storage={getItem:(key:string)=>saved.get(key)||null,setItem:(key:string,value:string)=>{saved.set(key,value);}};
 const firstRuntime=createOpeningSession(()=>storage);
 assert.equal(firstRuntime.claim(),true);
 assert.equal(firstRuntime.claim(),false);
 assert.equal(createOpeningSession(()=>storage).claim(),false,"A document reload retains the tab's welcome claim");
});

test("blocked storage cannot replay the welcome on every remount",()=>{
 const runtime=createOpeningSession(()=>{throw new DOMException("Access denied","SecurityError");});
 assert.equal(runtime.claim(),true);
 assert.equal(runtime.claim(),false);
 assert.equal(runtime.claim(),false);
});

test("a storage write failure still remembers the welcome for this runtime",()=>{
 const runtime=createOpeningSession(()=>({getItem:()=>null,setItem:()=>{throw new DOMException("Full","QuotaExceededError");}}));
 assert.equal(runtime.claim(),true);
 assert.equal(runtime.claim(),false);
});
