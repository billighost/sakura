import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createOpeningSession } from "../src/rebuild/app/openingSession";
import {fragmentId,scrollToFragment,waitForFragment,type FragmentScrollEnvironment} from "../src/rebuild/app/fragmentScroll";

const read=(path:string)=>readFileSync(path,"utf8");
function fragmentFixture(){
 const location={pathname:"/settings",hash:"#your-feed"},frames=new Set<()=>void>();let observe=()=>{},expiry=()=>{},watching=false;const nodes:HTMLElement[]=[];
 const container={id:"music-main",scrollTop:80,clientTop:2,getClientRects:()=>[{}],getBoundingClientRect:()=>({top:100}),querySelectorAll:()=>nodes} as unknown as HTMLElement;
 const target=(id="your-feed",visible=true,top=1200)=>({id,getClientRects:()=>visible?[{}]:[],getBoundingClientRect:()=>({top:100+top-container.scrollTop+container.clientTop})}) as unknown as HTMLElement;
 const environment:FragmentScrollEnvironment={location:()=>location,frame:callback=>{frames.add(callback);return()=>{frames.delete(callback);};},observe:(_container,callback)=>{watching=true;observe=callback;return()=>{watching=false;};},expire:callback=>{expiry=callback;return()=>{expiry=()=>{};};}};
 return {container,nodes,target,environment,location,get watching(){return watching;},flush(){for(const frame of [...frames]){frames.delete(frame);frame();}},mutate(){if(watching)observe();},expire(){expiry();}};
}

test("fragment scrolling selects the visible route target inside the music scroller",()=>{
 const f=fragmentFixture();f.nodes.push(f.target("your-feed",false,100),f.target());assert.equal(scrollToFragment(f.container,"#your-feed"),true);assert.equal(f.container.scrollTop,1200);
 assert.equal(fragmentId("#your%20feed"),"your feed");assert.equal(fragmentId("#%E0"),null);assert.equal(scrollToFragment(f.container,"#missing"),false);assert.equal(f.container.scrollTop,1200);
});
test("fragment navigation waits for streamed target mount and cleans up after scrolling",()=>{
 const f=fragmentFixture(),stop=waitForFragment(f.container,"/settings","#your-feed",f.environment);f.flush();assert.equal(f.container.scrollTop,80);assert.equal(f.watching,true);f.nodes.push(f.target());f.mutate();f.flush();assert.equal(f.container.scrollTop,1200);assert.equal(f.watching,false);stop();
});
test("leaving a route cancels pending fragment navigation without changing its saved scroll",()=>{
 const f=fragmentFixture();waitForFragment(f.container,"/settings","#your-feed",f.environment);f.location.pathname="/home";f.nodes.push(f.target());f.flush();assert.equal(f.container.scrollTop,80);assert.equal(f.watching,false);
});
test("cancelled fragment observers cannot scroll after a late target appears",()=>{
 const f=fragmentFixture(),stop=waitForFragment(f.container,"/settings","#your-feed",f.environment);stop();f.nodes.push(f.target());f.mutate();f.flush();assert.equal(f.container.scrollTop,80);assert.equal(f.watching,false);
});

test("music routes keep an instant loading shell and page-local transition",()=>{
 const layout=read("src/app/(music)/layout.tsx"),loading=read("src/app/(music)/loading.tsx"),ux=read("src/rebuild/app/NavigationUX.tsx"),css=read("src/rebuild/app/ink.module.css");
 assert.match(layout,/RouteTransition/);
 assert.match(loading,/MusicRouteLoading/);
 assert.match(ux,/router\.prefetch\("\/home"\)|for\(const href of \["\/home"|const pending=\["\/home"/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)[\s\S]*\.routeTransition/);
});

test("online Bloom routes warm the offline renderer before refreshing their cache record",()=>{
 const ux=read("src/rebuild/app/NavigationUX.tsx");
 assert.match(ux,/const loadBloomPage=\(\)=>import\("\.\.\/bloom\/BloomPage"\)/);
 assert.match(ux,/const BloomPage=dynamic\(loadBloomPage,/);
 assert.match(ux,/musicRoute\(pathname\)\?\.\[0\]!=="bloom"/);
 assert.match(ux,/!navigator\.onLine\|\|!worker\?\.controller/);
 assert.match(ux,/loadBloomPage\(\)\.then\(\(\)=>\{if\(!stopped&&location\.pathname===pathname\)rememberMusicRoute\(pathname\)/);
 assert.match(ux,/worker\?\.addEventListener\("controllerchange",warm\)/);
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
