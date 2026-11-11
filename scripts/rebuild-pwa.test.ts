import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import {musicRoute} from "../src/rebuild/app/offlineNavigation";

const source=readFileSync(new URL("../public/sw.js",import.meta.url),"utf8");
function fixture(){
 const origin="https://sakura.example",stores=new Map<string,Map<string,Response>>(),handlers=new Map<string,(event:unknown)=>void>(),requests:string[]=[];
 let offline=false,failStorage=false,failOpen=false,failMatch=false,fastTimeouts=false;
 const failures=new Set<string>(),responses=new Map<string,Response>(),hanging=new Set<string>();
 const address=(input:string|Request|URL)=>new URL(typeof input==="string"?input:input instanceof URL?input.href:input.url,origin).href;
 const cacheStorage={async open(name:string){if(failOpen)throw new DOMException("Storage unavailable","SecurityError");let data=stores.get(name);if(!data){data=new Map();stores.set(name,data);}return {async match(input:string|Request,options?:{ignoreSearch?:boolean}){if(failMatch)throw new Error("Read failed");const url=address(input),saved=data!.get(url)||options?.ignoreSearch&&[...data!].find(([key])=>new URL(key).pathname===new URL(url).pathname)?.[1];return saved?saved.clone():undefined;},async put(input:string|Request,response:Response){if(failStorage)throw new DOMException("Full","QuotaExceededError");data!.set(address(input),response.clone());}};}};
 const context=vm.createContext({self:{location:{origin},clients:{claim:async()=>{},get:async()=>null},skipWaiting:async()=>{},addEventListener(name:string,handler:(event:unknown)=>void){handlers.set(name,handler);}},caches:cacheStorage,Request,Response,Headers,URL,AbortController,DOMException,setTimeout(callback:()=>void,delay:number){return setTimeout(callback,fastTimeouts?Math.min(delay,20):delay);},clearTimeout,
  async fetch(input:string|Request|URL,options?:RequestInit){const url=address(input);requests.push(url);if(offline||failures.has(url))throw new TypeError("Failed to fetch");if(hanging.has(url))return new Promise<Response>((_,reject)=>options?.signal?.addEventListener("abort",()=>reject(options.signal!.reason),{once:true}));if(responses.has(url))return responses.get(url)!.clone();if(url.includes("/api/v2/image"))return new Response("image bytes",{headers:{"Content-Type":"image/png"}});if(url.includes("/_next/static/"))return new Response("module bytes",{headers:{"Content-Type":url.endsWith(".css")?"text/css":"text/javascript"}});return new Response('<main id="music-main"></main><script src="/_next/static/current.js"></script><link href="/_next/static/current.css" rel="stylesheet">',{headers:{"Content-Type":"text/html"}});},
 });vm.runInContext(source,context);
 const api=vm.runInContext("({cacheFirst,cacheDocument,CACHE,ASSETS,ARTWORK})",context);
 return {origin,stores,handlers,requests,api,context,failures,responses,hanging,set offline(value:boolean){offline=value;},set failStorage(value:boolean){failStorage=value;},set failOpen(value:boolean){failOpen=value;},set failMatch(value:boolean){failMatch=value;},set fastTimeouts(value:boolean){fastTimeouts=value;},async navigation(path:string){const request=new Request(origin+path);Object.defineProperty(request,"mode",{value:"navigate"});let response:Promise<Response>|undefined;const work:Promise<unknown>[]=[];handlers.get("fetch")!({request,respondWith(value:Promise<Response>){response=value;},waitUntil(value:Promise<unknown>){work.push(value);}});const result=await response!;await Promise.allSettled(work);return result;}};
}

test("music URL parsing includes saved collections and preserves encoded artist identities",()=>{
 for(const path of ["/home","/search","/discover","/library/downloaded","/liked","/bloom/chapter","/artist/deezer%3A42","/album/album-id"])assert.ok(musicRoute(path),path);
 assert.deepEqual(musicRoute("/artist/deezer%3A42"),["artist","deezer:42"]);
 for(const path of ["/login","/api/v2/profile","/home/extra","//external/path"])assert.equal(musicRoute(path),null);
});
test("an interrupted first navigation completes locally even when Wi-Fi reports online",()=>{
 const location={href:"https://sakura.example/home",pathname:"/home",origin:"https://sakura.example"};
 const history={pushState(_state:unknown,_title:string,href:string){const url=new URL(href,location.href);location.href=url.href;location.pathname=url.pathname;},replaceState(_state:unknown,_title:string,href:string){this.pushState(_state,_title,href);}};
 const exports={},context=vm.createContext({exports,module:{exports},location,navigator:{onLine:true},window:{location,history,dispatchEvent(){}},URL,Event,Date});
 const js=ts.transpileModule(readFileSync(new URL("../src/rebuild/app/offlineNavigation.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInContext(js,context);
 const api=vm.runInContext("module.exports",context),requests:string[]=[],router={push(href:string){requests.push(href);}};
 api.pushMusicUrl(router,"/artist/42");assert.equal(location.pathname,"/home");api.enterOfflineShell();assert.equal(api.localRouteSnapshot(),"/artist/42");
 api.pushMusicUrl(router,"/library/downloaded");assert.equal(location.pathname,"/library/downloaded");assert.deepEqual(requests,["/artist/42"]);
});
test("offline shell warming saves its modules before making the document available",async()=>{
 const f=fixture();await f.api.cacheDocument("/offline",true);
 assert.ok(f.stores.get(f.api.CACHE)?.has(f.origin+"/offline"));assert.ok(f.stores.get(f.api.ASSETS)?.has(f.origin+"/_next/static/current.js"));assert.ok(f.stores.get(f.api.ASSETS)?.has(f.origin+"/_next/static/current.css"));
});
test("deployment query parameters reuse the same immutable offline module",async()=>{
 const f=fixture();await f.api.cacheDocument("/offline",true);const count=f.requests.length;f.offline=true;
 const response=await f.api.cacheFirst(new Request(f.origin+"/_next/static/current.js?dpl=deployment-id"),f.api.ASSETS);assert.equal(await response.text(),"module bytes");assert.equal(f.requests.length,count);
});
test("cold offline artist, album and search deep links retain their original URL",async()=>{
 const f=fixture();await f.api.cacheDocument("/offline",true);f.offline=true;
 for(const path of ["/artist/deezer%3A42","/album/42","/search?q=flowers","/library/downloaded"]){const response=await f.navigation(path);assert.equal(response.status,200);assert.equal(response.headers.get("Location"),null);assert.match(await response.text(),/music-main/);}
});
test("parallel artwork consumers share one fetch and reuse it after a worker restart",async()=>{
 const f=fixture(),request=new Request(f.origin+"/api/v2/image?url=https%3A%2F%2Fimages.example%2Fcover.png");
 const responses=await Promise.all(Array.from({length:20},()=>f.api.cacheFirst(request,f.api.ARTWORK)));assert.equal(f.requests.length,1);for(const response of responses)assert.equal(await response.text(),"image bytes");
 vm.runInContext("resourceFlights.clear()",f.context);f.offline=true;assert.equal(await (await f.api.cacheFirst(request,f.api.ARTWORK)).text(),"image bytes");assert.equal(f.requests.length,1);
});
test("account APIs and router-state-dependent RSC responses never enter shared caches",()=>{
 const f=fixture();for(const request of [new Request(f.origin+"/api/v2/profile"),new Request(f.origin+"/artist/42?_rsc=state",{headers:{RSC:"1"}})]){let handled=false;f.handlers.get("fetch")!({request,respondWith(){handled=true;}});assert.equal(handled,false);}assert.equal(f.stores.size,0);
});
test("a full cache does not turn successful image delivery into a broken image",async()=>{
 const f=fixture();f.failStorage=true;const response=await f.api.cacheFirst(new Request(f.origin+"/api/v2/image?url=cover"),f.api.ARTWORK);assert.equal(response.status,200);assert.equal(await response.text(),"image bytes");
});
test("authentication redirects cannot overwrite a prepared offline route",async()=>{
 const f=fixture();await f.api.cacheDocument("/home");f.context.fetch=async()=>{const response=new Response("sign in",{headers:{"Content-Type":"text/html"}});Object.defineProperty(response,"redirected",{value:true});return response;};await f.api.cacheDocument("/home",true);assert.match(await f.stores.get(f.api.CACHE)!.get(f.origin+"/home")!.clone().text(),/music-main/);
});

function deployedDocument(){return new Response('<main id="music-main">new deployment</main><script src="/_next/static/new.js"></script><link href="/_next/static/new.css" rel="stylesheet">',{headers:{"Content-Type":"text/html"}});}
test("a failed deployment module cannot replace a usable offline shell",async()=>{
 const f=fixture();await f.api.cacheDocument("/offline",true);
 f.responses.set(f.origin+"/offline",deployedDocument());f.failures.add(f.origin+"/_next/static/new.js");
 assert.equal(await f.api.cacheDocument("/offline",true),false);
 assert.match(await f.stores.get(f.api.CACHE)!.get(f.origin+"/offline")!.clone().text(),/current\.js/);
 f.offline=true;assert.equal((await f.navigation("/artist/42")).status,200);
});
test("a navigation document commits only after all required JS and CSS are saved",async()=>{
 const f=fixture();await f.api.cacheDocument("/home");f.responses.set(f.origin+"/home",deployedDocument());
 // A deployment proxy returning an HTML error with status 200 is not a module.
 f.responses.set(f.origin+"/_next/static/new.js",new Response("error page",{headers:{"Content-Type":"text/html"}}));
 assert.match(await (await f.navigation("/home")).text(),/new deployment/);
 assert.match(await f.stores.get(f.api.CACHE)!.get(f.origin+"/home")!.clone().text(),/current\.js/);
 f.responses.delete(f.origin+"/_next/static/new.js");await f.navigation("/home");
 assert.match(await f.stores.get(f.api.CACHE)!.get(f.origin+"/home")!.clone().text(),/new\.js/);
 assert.ok(f.stores.get(f.api.ASSETS)!.has(f.origin+"/_next/static/new.js"));
 assert.ok(f.stores.get(f.api.ASSETS)!.has(f.origin+"/_next/static/new.css"));
});
test("quota failure during module warming retains the previous complete document",async()=>{
 const f=fixture();await f.api.cacheDocument("/offline",true);f.responses.set(f.origin+"/offline",deployedDocument());f.failStorage=true;
 assert.equal(await f.api.cacheDocument("/offline",true),false);
 assert.match(await f.stores.get(f.api.CACHE)!.get(f.origin+"/offline")!.clone().text(),/current\.js/);
});
test("cache-open and cache-read failures still deliver successful network responses",async()=>{
 for(const failure of ["failOpen","failMatch"] as const){
  const f=fixture();f[failure]=true;
  assert.equal(await (await f.api.cacheFirst(new Request(f.origin+"/api/v2/image?url=cover"),f.api.ARTWORK)).text(),"image bytes");
  assert.equal((await f.navigation("/home")).status,200);
  assert.equal(f.requests.filter(url=>url===f.origin+"/home").length,1);
  assert.equal(f.requests.filter(url=>url.includes("/api/v2/image")).length,1);
 }
});
test("temporary origin failures use saved pages while authorization errors stay authoritative",async()=>{
 const f=fixture();await f.api.cacheDocument("/home");await f.api.cacheDocument("/offline",true);
 for(const status of [500,502,503,504]){
  f.responses.set(f.origin+"/home",new Response("Origin temporarily unavailable",{status}));
  assert.equal((await f.navigation("/home")).status,200);
 }
 for(const status of [401,403,404]){
  f.responses.set(f.origin+"/home",new Response("Access unavailable",{status}));
  assert.equal((await f.navigation("/home")).status,status);
 }
 f.responses.set(f.origin+"/artist/42",new Response("Origin temporarily unavailable",{status:503}));
 assert.equal((await f.navigation("/artist/42")).status,200);
});
test("visited public information pages are cached without substituting an unrelated shell",async()=>{
 const f=fixture();await f.api.cacheDocument("/offline",true);
 for(const path of ["/about","/privacy","/terms"]){await f.navigation(path);assert.ok(f.stores.get(f.api.CACHE)!.has(f.origin+path));}
 f.offline=true;for(const path of ["/about","/privacy","/terms"])assert.equal((await f.navigation(path)).status,200);
 assert.equal((await f.navigation("/login")).status,503);
});
test("an incomplete old document falls back to the usable neutral shell",async()=>{
 const f=fixture();await f.api.cacheDocument("/offline",true);f.stores.get(f.api.CACHE)!.set(f.origin+"/home",deployedDocument());f.offline=true;
 const response=await f.navigation("/home");assert.equal(response.status,200);assert.match(await response.text(),/current\.js/);
});
test("a stalled required module times out without losing the working deployment",async()=>{
 const f=fixture();await f.api.cacheDocument("/offline",true);f.responses.set(f.origin+"/offline",deployedDocument());f.hanging.add(f.origin+"/_next/static/new.js");f.fastTimeouts=true;
 assert.equal(await f.api.cacheDocument("/offline",true),false);
 assert.match(await f.stores.get(f.api.CACHE)!.get(f.origin+"/offline")!.clone().text(),/current\.js/);
 assert.equal(vm.runInContext("resourceFlights.size+documentFlights.size",f.context),0);
});
