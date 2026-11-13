import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {Writable} from "node:stream";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import {renderToPipeableStream} from "react-dom/server";
import type {PublicShare} from "../src/rebuild/player/SharedSong";

const share:PublicShare={slug:"abcdefghijklmnop",kind:"lyric",payload:{recordingId:"recording-one",title:"Public card is ready",artists:["Fixture artist"],albumTitle:null,durationMs:120000,coverUrl:null,lines:[{start:12.345,text:"The public words"}],reference:null,references:[],colorMode:"light"}};
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function moduleFrom<T>(path:string,dependencies:Record<string,unknown>):T{
 const exports={},context=vm.createContext({module:{exports},exports,console,URLSearchParams,require(name:string){if(name in dependencies)return dependencies[name];throw new Error("Unexpected streaming fixture dependency: "+name);}});
 const source=ts.transpileModule(readFileSync(path,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInContext(source,context);return context.module.exports as T;
}
function fixture(account:Promise<{id:string}|null>,publicShare:PublicShare|null=share){
 const link=({children,...props}:{children:React.ReactNode})=>React.createElement("a",props,children);
 const icon=()=>React.createElement("svg",{"aria-hidden":true});
 const shared=moduleFrom<typeof import("../src/rebuild/player/SharedSong")>("src/rebuild/player/SharedSong.tsx",{"react":React,"react/jsx-runtime":jsxRuntime,"next/link":{default:link},"../app/Icon":{Icon:icon},"./Primitives":{Artwork:()=>React.createElement("div"),PlayerIcon:icon},"./shared.module.css":{default:new Proxy({},{get:(_target,key)=>String(key)})}});
 const page=moduleFrom<{default:(props:{params:Promise<{slug:string}>})=>Promise<React.ReactElement>}>("src/app/s/[slug]/page.tsx",{
  "react":React,"react/jsx-runtime":jsxRuntime,"next/server":{connection:async()=>{}},"next/navigation":{notFound:()=>{throw new Error("NOT_FOUND");}},
  "@/rebuild/data/shares":{validShareSlug:(slug:string)=>/^[A-Za-z0-9_-]{16}$/.test(slug)},
  "@/rebuild/seo/public-data":{readShareForPage:async()=>publicShare},
  "@/rebuild/seo/entity":{publicShareMetadata:(current:PublicShare)=>({title:current.payload.title})},
  "@/rebuild/auth":{requireRebuildAccount:()=>account},"@/rebuild/player/SharedSong":shared,
 });
 return {page:page.default,shared};
}
function stream(element:React.ReactNode){
 const chunks:string[]=[],shell=deferred<void>(),complete=deferred<void>(),errors:unknown[]=[];
 void complete.promise.catch(()=>{});
 const output=new Writable({write(chunk,_encoding,done){chunks.push(String(chunk));done();}});
 output.on("finish",()=>complete.resolve());
 const rendered=renderToPipeableStream(element,{onShellReady(){rendered.pipe(output);shell.resolve();},onShellError(error){shell.reject(error);complete.reject(error);},onError(error){errors.push(error);}});
 return {shell:shell.promise,complete:complete.promise,html:()=>chunks.join(""),errors,abort:()=>rendered.abort()};
}

test("public share content streams before an account read settles and then receives its signed-in action",async()=>{
 const account=deferred<{id:string}|null>(),{page}=fixture(account.promise),rendered=stream(React.createElement(page,{params:Promise.resolve({slug:share.slug})}));
 await rendered.shell;assert.match(rendered.html(),/Public card is ready/);assert.match(rendered.html(),/The public words/);
 assert.doesNotMatch(rendered.html(),/href="\/track\/recording-one/);
 account.resolve({id:"existing-account"});await rendered.complete;
 assert.match(rendered.html(),/href="\/track\/recording-one\?at=12345&amp;share=abcdefghijklmnop"/);assert.deepEqual(rendered.errors,[]);
});

test("an unavailable or deleted account keeps the public card and uses the safe sign-in action",async()=>{
 for(const failure of [false,true]){
  const account=deferred<{id:string}|null>(),{page}=fixture(account.promise),rendered=stream(React.createElement(page,{params:Promise.resolve({slug:share.slug})}));
  await rendered.shell;assert.match(rendered.html(),/Public card is ready/);
  if(failure)account.reject(new Error("Account database unavailable"));else account.resolve(null);
  await rendered.complete;assert.match(rendered.html(),/href="\/login\?next=%2Ftrack%2Frecording-one%3Fat%3D12345%26share%3Dabcdefghijklmnop"/);assert.match(rendered.html(),/href="\/register\?next=/);assert.deepEqual(rendered.errors,[]);
 }
});

test("invalid and revoked public shares remain unavailable regardless of account state",async()=>{
 const {page}=fixture(Promise.resolve({id:"existing-account"}));
 await assert.rejects(page({params:Promise.resolve({slug:"invalid"})}),/NOT_FOUND/);
 const {page:missing}=fixture(Promise.resolve(null),null);
 await assert.rejects(missing({params:Promise.resolve({slug:share.slug})}),/NOT_FOUND/);
});
