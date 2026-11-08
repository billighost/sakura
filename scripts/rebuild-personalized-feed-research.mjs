import {mkdir,writeFile} from 'node:fs/promises';

const sources = [
 ['Spotify taste controls','https://support.spotify.com/us/article/your-taste-profile/'],
 ['Spotify shuffle','https://support.spotify.com/us/article/shuffle-play/'],
 ['Spotify taste exclusion','https://support.spotify.com/us/article/exclude-playlists-or-tracks-from-your-taste-profile/'],
 ['Spotify daylist','https://newsroom.spotify.com/2023-09-12/ever-changing-playlist-daylist-music-for-all-day/'],
 ['Spotify Discover Weekly','https://newsroom.spotify.com/2025-06-30/discover-weekly-turns-10-celebrating-100-billion-tracks-streamed-and-a-decade-of-personalized-discovery/'],
 ['Spotify Home previews','https://newsroom.spotify.com/2023-03-08/spotify-previews-clips-music-podcasts-audiobooks-home-feed/'],
 ['Spotify Home taste control','https://newsroom.spotify.com/2026-09-23/taste-profile-shape-home-feed/'],
 ['Apple Music recommendations','https://support.apple.com/guide/iphone/get-personalized-recommendations-iph2b1748696/ios'],
 ['Apple Music radio','https://support.apple.com/guide/iphone/listen-to-radio-iph0fc7cdac1/ios'],
 ['Apple Music Replay','https://support.apple.com/en-us/109356'],
 ['YouTube Music recommendations','https://support.google.com/youtubemusic/answer/6313542?hl=en'],
 ['YouTube Music radio','https://support.google.com/youtubemusic/answer/11531230?hl=en'],
 ['YouTube Music custom radio','https://blog.youtube/news-and-events/youtube-music-radio-builder/'],
 ['Deezer Flow Tuner launch','https://newsroom-deezer.com/2026/02/deezer-launches-flow-tuner-personalized-recommendations/'],
 ['Deezer Flow Tuner controls','https://newsroom-deezer.com/2026/02/introducing-flow-tuner-your-music-your-rules/'],
 ['Deezer Flow personalization','https://newsroom-deezer.com/2023/07/deezer-takes-flow-to-the-next-level-and-makes-it-the-perfect-musical-companion-for-every-occasion/'],
 ['Deezer Flow Moods','https://newsroom-deezer.com/2022/07/flow-moods-recommending-music-by-moods-on-deezer/'],
 ['TIDAL My Mix','https://support.tidal.com/hc/en-us/articles/360002112918-My-Mix'],
 ['Pandora Modes','https://help.pandora.com/s/article/Pandora-Modes?language=en_US'],
 ['Amazon Music Maestro','https://www.aboutamazon.com/news/entertainment/amazon-music-maestro-ai-playlist-generator'],
 ['SoundCloud stations','https://help.soundcloud.com/hc/en-us/articles/115003453807-Stations'],
 ['SoundCloud discovery','https://soundcloud.com/discover'],
 ['SoundCloud Home social discovery','https://soundcloud.com/playbook-articles/soundcloud-just-got-more-social-new-features-revamped-homepage-for-shared-discovery/'],
 ['SoundCloud genre filters','https://soundcloud.com/playbook-articles/introducing-mood-genre-filters/'],
 ['SoundCloud favorite-artist releases','https://soundcloud.com/playbook-articles/soundclouds-new-release-notifications-mean-youll-never-miss-the-latest-music-from-the-artists-you-follow/'],
 ['Bandcamp Discover','https://bandcamp.com/discover'],
 ['Bandcamp Daily','https://daily.bandcamp.com/'],
 ['Bandcamp Updates','https://blog.bandcamp.com/'],
 ['Bandcamp discovery improvements','https://blog.bandcamp.com/2026/07/16/discover-improvements-and-subsonic-implementation/'],
 ['Bandcamp human curation','https://blog.bandcamp.com/2025/09/01/discover-bandcamp-clubs-curated-music-experiences/'],
];
const clean=html=>html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/&#39;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/&[^;\s]{1,12};/g,' ').replace(/\s+/g,' ').trim();
const patterns=[/taste profile/ig,/discovery/ig,/discover weekly/ig,/daylist/ig,/recommend/ig,/familiar/ig,/variety/ig,/radio/ig,/flow/ig,/my mix/ig,/station/ig,/genre/ig,/history/ig,/listening/ig,/feedback/ig,/exclude/ig,/discover/ig,/filter/ig,/tag/ig,/queue/ig,/favorite/ig,/deep cuts/ig,/maestro/ig];
async function read([label,url]){
 try{
  const response=await fetch(url,{signal:AbortSignal.timeout(20000),headers:{'User-Agent':'Mozilla/5.0 (compatible; Sakura public product research)'}});
  if(!response.ok){await response.body?.cancel();return {label,url,finalUrl:response.url,status:response.status,verified:false};}
  const html=await response.text();
  if(html.length>5*1024*1024)return {label,url,status:response.status,verified:false,reason:'Oversized response'};
  if(response.headers.get('content-type')?.includes('application/json')){
   const data=JSON.parse(html);return {label,url,status:response.status,verified:true,results:Array.isArray(data)?data.map(x=>({title:x.title,url:x.url})):data};
  }
  let content=clean(html);const title=clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]||'');
  if(new URL(response.url).hostname==='support.apple.com'){
   const heading=title.replace(/ - Apple Support$/,'');
   const articleStart=content.indexOf(heading,heading.length);
   if(articleStart>=0)content=content.slice(articleStart);
  }
  const verified=content.length>900&&!/page not found|client challenge|access denied|just a moment|checking your browser|error 404|not found|^iPhone User Guide/i.test(title)&&!/doesn.t exist|couldn.t find (this|that) page/i.test(content);
  const excerpts=[],positions=[];
  if(verified)for(const pattern of patterns){let match,count=0;pattern.lastIndex=0;while((match=pattern.exec(content))&&count++<5){
   if(positions.some(position=>Math.abs(position-match.index)<350))continue;
   positions.push(match.index);excerpts.push(content.slice(Math.max(0,match.index-100),match.index+570));
  }}
  return {label,url,finalUrl:response.url,status:response.status,title,verified,characters:content.length,excerpts:verified?excerpts.slice(0,8):[]};
 }catch(error){return {label,url,verified:false,error:error instanceof Error?error.message:'Fetch failed'};}
}
const initial=await Promise.all(sources.map(read));
const discovered=initial.flatMap(item=>Array.isArray(item.results)?item.results.map(result=>[result.title,result.url]):[]);
const additional=await Promise.all(discovered.map(read));
const report={generatedAt:new Date().toISOString(),sources:[...initial,...additional]};
await mkdir('docs/rebuild',{recursive:true});
await writeFile('docs/rebuild/PERSONALIZED-FEED-SOURCES.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report.sources.map(({label,url,title,status,verified,results,error})=>({label,url,title,status,verified,results,error})),null,2));
