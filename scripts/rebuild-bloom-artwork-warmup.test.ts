import assert from "node:assert/strict";
import {test} from "node:test";
import {bloomArtworkWarmUrls} from "../src/rebuild/bloom/artworkWarmup";
import type {BloomPreparedStory} from "../src/rebuild/bloom/uiTypes";

const chapter=(id:string,urls:string[])=>({id,title:id,prompt:"",stat:null,relatedRecording:null,recordings:urls.map((coverUrl,index)=>({rank:index+1,audibleMs:1000,plays:1,recording:{coverUrl}}))});
const prepared=(chapters:ReturnType<typeof chapter>[])=>({chapters}) as unknown as BloomPreparedStory;

test("Bloom warms nearby sleeves before highlights and does not download every future chapter",()=>{
 const value=prepared([chapter("time",["/current.jpg"]),chapter("songs",["/next.jpg"]),chapter("future",["/future.jpg"]),chapter("top-song",["/winner.jpg"]),chapter("song-countdown",["/winner.jpg","/runner.jpg"])]);
 assert.deepEqual(bloomArtworkWarmUrls(value,0),["/current.jpg","/next.jpg","/winner.jpg","/runner.jpg"]);
 assert.ok(bloomArtworkWarmUrls(value,1).includes("/future.jpg"),"A future chapter warms when it becomes the next chapter");
});

test("large Bloom stories bound concurrent warmups to six distinct sources",()=>{
 const value=prepared([chapter("songs",Array.from({length:30},(_,index)=>`/song-${index}.jpg`)),chapter("top-song",["/winner.jpg"])]);
 assert.equal(bloomArtworkWarmUrls(value,0).length,6);
 assert.equal(new Set(bloomArtworkWarmUrls(value,0)).size,6);
 assert.deepEqual(bloomArtworkWarmUrls(null,0),[]);
});

test("native artwork warming uses phone retina quality while arbitrary and signed sources stay exact",()=>{
 const raw="https://cdn-images.dzcdn.net/images/cover/5718f7c81c27e0b2417e2a4c45224f8a/1000x1000-000000-80-0-0.jpg";
 const signed=raw+"?signed=preserve";
 const [native,exact]=bloomArtworkWarmUrls(prepared([chapter("songs",[raw,signed])]),0);
 assert.equal(native,`/api/v2/image?url=${encodeURIComponent(raw.replace("1000x1000","640x640"))}`);
 assert.equal(exact,`/api/v2/image?url=${encodeURIComponent(signed)}`);
});
