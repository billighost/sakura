import assert from "node:assert/strict";
import test from "node:test";
import {currentOfflineSave,downloadActivityLabel,downloadBytes,downloadPercent,visibleDownloads} from "../src/rebuild/app/downloadPresentation";
import type {DownloadEntry,MusicTrack} from "../src/rebuild/app/types";

const track={id:"exact-recording",title:"夜に駆ける",artists:["YOASOBI"],durationMs:240000,reference:{provider:"deezer",id:"1"},references:[],versionLabel:"Original recording",coverUrl:null,artistId:null,albumId:null,albumTitle:null} as MusicTrack;
function job(patch:Partial<DownloadEntry>={}):DownloadEntry{return {recordingId:track.id,track,status:"downloading",downloadedBytes:1024,totalBytes:4096,operationId:"one",...patch};}

test("only explicit downloads belong to the downloads collection; queue preparation stays out",()=>{
 const explicit=job({requested:true}),oldSaved=job({status:"ready"}),prefix=job({status:"prepared",requested:false}),playedCache=job({status:"ready",requested:false});
 assert.deepEqual(visibleDownloads([explicit,oldSaved,prefix,playedCache]),[explicit,oldSaved]);
});
test("download progress remains bounded when metadata is missing or stale",()=>{
 assert.equal(downloadPercent(job()),25);
 assert.equal(downloadPercent(job({totalBytes:null})),null);
 assert.equal(downloadPercent(job({totalBytes:0})),null);
 assert.equal(downloadPercent(job({totalBytes:Infinity})),null);
 assert.equal(downloadPercent(job({downloadedBytes:8192})),100);
 assert.equal(downloadPercent(job({downloadedBytes:-500})),0);
 assert.equal(downloadPercent(job({downloadedBytes:NaN})),0);
});
test("paused and queued downloads describe preserved bytes instead of claiming completed songs",()=>{
 assert.equal(downloadActivityLabel(job({status:"paused"})),"Paused · 1 KB saved");
 assert.equal(downloadActivityLabel(job({status:"queued"})),"Waiting its turn · 1 KB saved");
 assert.equal(downloadActivityLabel(job({status:"queued",downloadedBytes:0})),"Waiting its turn");
 assert.equal(downloadActivityLabel(job({status:"prepared"})),"Opening saved · 1 KB saved");
 assert.equal(downloadActivityLabel(job({status:"resolving"})),"Finding your recording");
 assert.equal(downloadActivityLabel(job({status:"failed"})),"Save incomplete · Retry to finish");
 assert.equal(downloadActivityLabel(job({downloadedBytes:4096})),"Checking your saved song");
});
test("storage labels handle invalid and byte sized measurements",()=>{
 assert.equal(downloadBytes(NaN),"0 MB");assert.equal(downloadBytes(-1),"0 MB");assert.equal(downloadBytes(1),"1 KB");assert.equal(downloadBytes(2*1024*1024),"2.0 MB");
});
test("currently playing audio does not turn cached or unfinished downloads into offline saves",()=>{
 assert.equal(currentOfflineSave(track.id,[job({requested:true,status:"ready"})]).kind,"ready");
 assert.equal(currentOfflineSave(track.id,[job({status:"ready"})]).kind,"ready");
 assert.equal(currentOfflineSave(track.id,[job({requested:false,status:"ready"})]).kind,"unsaved");
 assert.equal(currentOfflineSave(track.id,[job({requested:false,status:"prepared"})]).kind,"unsaved");
 assert.equal(currentOfflineSave(track.id,[job({requested:true,status:"failed"})]).kind,"failed");
 assert.equal(currentOfflineSave(track.id,[job({requested:true,status:"paused"})]).kind,"paused");
 assert.equal(currentOfflineSave(track.id,[job({requested:true,status:"downloading",downloadedBytes:4096})]).kind,"saving");
 assert.equal(currentOfflineSave("another-recording",[job({requested:true,status:"ready"})]).kind,"unsaved");
});
