import http from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { parseByteRange } from "../worker/rebuild/core/streaming.js";

const option=(name,fallback)=>{const at=process.argv.indexOf(name);return at<0?fallback:process.argv[at+1]||fallback;};
const root=resolve(option("--root",".local/audio-review"));let port=Number(option("--port",process.env.SAKURA_REVIEW_PORT||"3097")),attempts=0;
const mimes={".html":"text/html; charset=utf-8",".json":"application/json; charset=utf-8",".mp3":"audio/mpeg",".m4a":"audio/mp4",".flac":"audio/flac",".ogg":"audio/ogg",".wav":"audio/wav"};
const server=http.createServer(async(req,res)=>{
 try{
  if(!["GET","HEAD"].includes(req.method)){res.writeHead(405,{Allow:"GET, HEAD"});res.end();return;}
  const url=new URL(req.url,"http://127.0.0.1"),path=decodeURIComponent(url.pathname==="/"?"/index.html":url.pathname);
  const file=resolve(root,"."+path);if(!file.startsWith(root+sep)||path.includes("\0")){res.writeHead(404);res.end();return;}
  const info=await stat(file);if(!info.isFile()||!mimes[extname(file)]){res.writeHead(404);res.end();return;}
  const range=parseByteRange(req.method==="HEAD"?null:req.headers.range||null,info.size),headers={"Content-Type":mimes[extname(file)],"Cache-Control":"no-store","Accept-Ranges":"bytes","X-Content-Type-Options":"nosniff"};
  if(range.status==="unsatisfiable"){res.writeHead(416,{...headers,"Content-Range":`bytes */${info.size}`});res.end();return;}
  const start=range.status==="range"?range.start:0,end=range.status==="range"?range.end:info.size-1;
  res.writeHead(range.status==="range"?206:200,{...headers,"Content-Length":String(Math.max(0,end-start+1)),...(range.status==="range"?{"Content-Range":`bytes ${start}-${end}/${info.size}`}:{})});
  if(req.method==="HEAD"||!info.size){res.end();return;}
  const stream=createReadStream(file,{start,end});res.on("close",()=>stream.destroy());stream.on("error",()=>res.destroy());stream.pipe(res);
 }catch{if(!res.headersSent)res.writeHead(404);res.end();}
});
server.on("error",error=>{if(error.code==="EADDRINUSE"&&attempts++<10){port++;server.listen(port,"127.0.0.1");}else{console.error("The local listening review could not start.");process.exitCode=1;}});
server.on("listening",()=>console.log(`Sakura listening review: http://127.0.0.1:${port} · Ctrl+C to stop`));
server.listen(port,"127.0.0.1");
