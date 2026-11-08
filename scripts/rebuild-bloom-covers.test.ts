import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {test} from "node:test";
import {BLOOM_WORLDS} from "../src/rebuild/bloom/worlds/registry";
import {bloomCoverImage} from "../src/rebuild/bloom/coverAssets";
import {BLOOM_COVER_REVISION} from "../src/rebuild/bloom/coverRevision";

test("every authored world has current, bounded light and dark WebP card assets",async()=>{
 const manifest=JSON.parse(await readFile(new URL("../src/rebuild/bloom/cover-manifest.json",import.meta.url),"utf8"));
 assert.equal(manifest.assets.length,BLOOM_WORLDS.length*2);assert.equal(manifest.revision,BLOOM_COVER_REVISION);
 let totalBytes=0;const seen=new Set(),revision=createHash("sha256");
 for(const asset of manifest.assets){
  assert.ok(BLOOM_WORLDS.some(world=>world.id===asset.world));assert.ok(["light","dark"].includes(asset.theme));
  const key=asset.world+":"+asset.theme;assert.equal(seen.has(key),false);seen.add(key);assert.equal(asset.files.length,2);
  const art=await readFile(new URL(`../src/rebuild/bloom/worlds/${asset.world}/World.tsx`,import.meta.url)),css=await readFile(new URL(`../src/rebuild/bloom/worlds/${asset.world}/world.module.css`,import.meta.url));
  assert.equal(asset.sourceHash,createHash("sha256").update(art).update(css).digest("hex"),`${key} needs regeneration after artwork changes`);
  for(const file of asset.files){
   const bytes=await readFile(new URL("../public"+file.path,import.meta.url)),digest=createHash("sha256").update(bytes).digest("hex");
   assert.equal(bytes.length,file.bytes);assert.equal(digest,file.sha256);assert.ok(bytes.length<180000);
   assert.equal(bytes.toString("ascii",0,4),"RIFF");assert.equal(bytes.toString("ascii",8,12),"WEBP");
   const frame=bytes.indexOf(Buffer.from([0x9d,0x01,0x2a]));assert.ok(frame>0);
   assert.equal(bytes.readUInt16LE(frame+3)&0x3fff,file.width);assert.equal(bytes.readUInt16LE(frame+5)&0x3fff,file.height);
   assert.ok([480,960].includes(file.width));assert.equal(file.height,file.width*3/4);totalBytes+=bytes.length;revision.update(digest);
  }
 }
 assert.equal(totalBytes,manifest.totalBytes);assert.ok(totalBytes<4000000);assert.equal(revision.digest("hex").slice(0,12),manifest.revision);
});

test("cover identity, palette and legacy names resolve to stable cached assets",()=>{
 for(const world of BLOOM_WORLDS)for(const theme of ["light","dark"] as const){
  const image=bloomCoverImage(world.id,theme);assert.match(image.src,new RegExp(`/${world.id}-${theme}-480\\.webp\\?v=${BLOOM_COVER_REVISION}$`));
  assert.ok(image.srcSet.includes(`${world.id}-${theme}-960.webp`));assert.equal(image.width/image.height,4/3);
 }
 assert.deepEqual(bloomCoverImage("herbarium","light"),bloomCoverImage("sakura","light"));
 assert.deepEqual(bloomCoverImage("nocturne","dark"),bloomCoverImage("cosmos","dark"));
 assert.deepEqual(bloomCoverImage("risograph","light"),bloomCoverImage("glass","light"));
});
