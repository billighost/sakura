import {mkdir,writeFile} from 'node:fs/promises';
const urls=[
 'https://newsroom.spotify.com/2023-09-12/meet-daylist-your-day-in-a-playlist/',
 'https://support.spotify.com/us/article/made-for-you/',
 'https://support.spotify.com/us/article/spotify-wrapped/',
 'https://support.google.com/youtubemusic/answer/11418178?hl=en',
 'https://support.apple.com/en-us/109356',
 'https://bandcamp.com/discover',
 'https://daily.bandcamp.com/',
];
const clean=html=>html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&[^;\s]{1,12};/g,' ').replace(/\s+/g,' ').trim();
const results=await Promise.allSettled(urls.map(async url=>{
 const response=await fetch(url,{signal:AbortSignal.timeout(25000),headers:{'User-Agent':'Sakura product research (public documentation)'}});
 if(!response.ok){await response.body?.cancel();return {url,status:response.status,verified:false};}
 const html=await response.text();if(html.length>4*1024*1024)throw new Error('Documentation too large');
 const content=clean(html),title=clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]||'');
 const patterns=[/daylist/ig,/recap/ig,/replay/ig,/weekly/ig,/monthly/ig,/history/ig,/discover/ig,/genre/ig,/recommend/ig,/wrapped/ig];
 const excerpts=[];for(const pattern of patterns){let match,count=0;while((match=pattern.exec(content))&&count++<2)excerpts.push(content.slice(Math.max(0,match.index-130),match.index+350));}
 const verified=!/page not found|client challenge|access denied|just a moment|checking your browser/i.test(title)&&content.length>1000;
 return {url,finalUrl:response.url,status:response.status,title,verified,characters:content.length,excerpts:verified?[...new Set(excerpts)].slice(0,14):[]};
}));
const report={generatedAt:new Date().toISOString(),sources:results.map((r,i)=>r.status==='fulfilled'?r.value:{url:urls[i],verified:false,error:r.reason instanceof Error?r.reason.name:'FetchFailed'})};
await mkdir('.local/rebuild-research',{recursive:true});await writeFile('.local/rebuild-research/discovery.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
