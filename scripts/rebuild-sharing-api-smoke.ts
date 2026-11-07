/** Live authentication, linguistic engine, source matching and canonical public sharing. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import dotenv from 'dotenv';
dotenv.config({path:'.env.local',quiet:true});dotenv.config({path:'.env',quiet:true});
async function main(){
const base=process.env.SAKURA_TEST_URL||'http://localhost:3000';
const session=JSON.parse(await fs.readFile('.local/rebuild-test-account.json','utf8'));
const headers={Cookie:session.cookie,'Content-Type':'application/json',Origin:base};
async function request(path:string,options:RequestInit={}){return fetch(base+path,{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(60000)});}
if(process.argv.includes('--origin-only')){
 assert.equal((await request('/api/v2/shares',{method:'POST',body:'{}'})).status,400);
 assert.equal((await request('/api/v2/shares',{method:'POST',headers:{Origin:'https://attacker.invalid'},body:'{}'})).status,403);
 console.log(JSON.stringify({sameOriginAccepted:true,crossOriginRejected:true,authenticated:true}));return;
}
const unauth=await fetch(base+'/api/v2/readings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lines:['東京へ行く']})});assert.equal(unauth.status,401);
const original=[{text:'東京へ行く',start:1.25,end:3,words:[{text:'東京',start:1.25,end:2},{text:'へ行く',start:2,end:3}]},{text:'一人と二人',start:3,end:5}];
const readings=await request('/api/v2/readings',{method:'POST',body:JSON.stringify({language:'ja',lines:original})});assert.equal(readings.status,200);const readingData=await readings.json();
assert.equal(readingData.lines[0].romanized,'toukyou e iku');assert.equal(readingData.lines[1].romanized,'hitori to futari');
for(let i=0;i<original.length;i++){assert.equal(readingData.lines[i].text,original[i].text);assert.equal(readingData.lines[i].start,original[i].start);assert.equal(readingData.lines[i].end,original[i].end);assert.deepEqual(readingData.lines[i].words,original[i].words);}
assert.equal((await request('/api/v2/readings',{method:'POST',body:JSON.stringify({language:'ko',lines:['test']})})).status,400);
assert.equal((await request('/api/v2/lyrics?title=Lemon')).status,400);
const lyrics=await request('/api/v2/lyrics?'+new URLSearchParams({title:'Lemon',artist:'米津玄師',duration:'255',language:'ja'}));assert.equal(lyrics.status,200);const lyricData=await lyrics.json();assert.equal(lyricData.status,'matched');assert.ok(lyricData.lines.length>20);assert.ok(lyricData.lines.some((line:{text:string})=>/[\p{Script=Hiragana}]/u.test(line.text)));
const {getRebuildPool}=await import('../src/rebuild/data/db');const pool=getRebuildPool();
try{
 const recording=(await pool.query('SELECT id,metadata FROM sakura_v2."Recording" WHERE state=\'verified\' ORDER BY created_at DESC LIMIT 1')).rows[0];assert.ok(recording,'Fresh canonical catalog is seeded');
 assert.equal((await request('/api/v2/shares',{method:'POST',headers:{Origin:'https://attacker.invalid'},body:JSON.stringify({recordingId:recording.id,kind:'track'})})).status,403);
 const share=await request('/api/v2/shares',{method:'POST',body:JSON.stringify({recordingId:recording.id,kind:'track',colorMode:'dark',title:'UNTRUSTED CLIENT TITLE',artists:['UNTRUSTED'],coverUrl:'https://attacker.invalid/a.png'})});assert.equal(share.status,201);const created=await share.json();assert.equal(created.payload.title,recording.metadata.title);assert.notEqual(created.payload.coverUrl,'https://attacker.invalid/a.png');assert.match(created.slug,/^[A-Za-z0-9_-]{16}$/);
 const publicResponse=await fetch(base+'/api/v2/shares/'+created.slug);assert.equal(publicResponse.status,200);const publicData=await publicResponse.json();assert.equal(publicData.payload.recordingId,recording.id);assert.equal(publicData.payload.title,recording.metadata.title);assert.equal('account_id' in publicData,false);assert.equal('email' in publicData,false);
 const page=await fetch(base+created.url);assert.equal(page.status,200);const html=await page.text();assert.ok(html.includes('Listen on Sakura'));assert.ok(html.includes(encodeURIComponent('/track/'+recording.id+'?at=0&share='+created.slug)));
 assert.equal((await fetch(base+'/api/v2/shares/not-valid')).status,404);
 await pool.query('UPDATE sakura_v2."Share" SET deleted_at=now() WHERE slug=$1',[created.slug]);assert.equal((await fetch(base+'/api/v2/shares/'+created.slug)).status,404);
 assert.equal((await request('/api/v2/shares',{method:'POST',body:JSON.stringify({recordingId:recording.id,kind:'lyric',lines:[]})})).status,400);
 assert.equal((await fetch(base+'/api/v2/image?url='+encodeURIComponent('http://127.0.0.1/private'))).status,400);
 const report={checkedAt:new Date().toISOString(),authentication:true,readings:{actualEngine:true,sourceAndTimingPreserved:true,counterAndParticleReadings:true},lyrics:{actualProvider:'LRCLib',song:'Lemon',matched:true,lineCount:lyricData.lines.length},sharing:{sameOriginAccepted:true,crossOriginRejected:true,canonicalMetadata:true,publicWithoutAccountDetails:true,page:true,deletion:true},imagePolicy:true};
 await fs.writeFile('.local/rebuild-sharing-api-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await pool.end();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
