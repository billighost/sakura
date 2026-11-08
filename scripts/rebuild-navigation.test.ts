import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

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
