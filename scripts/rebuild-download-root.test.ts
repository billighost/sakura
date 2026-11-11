import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkerAudioDiscovery} from '../src/rebuild/server/sources';
import {parseRecordingTitle} from '../src/rebuild/core/identity';
import {assessAudioCandidate} from '../src/rebuild/core/matching';
import {responseIssue,userIssue} from '../src/rebuild/app/errors';
const recording={recordingId:'00000000-0000-4000-8000-000000000001',references:[{provider:'deezer' as const,id:'1'}],metadata:{title:'Example',artists:['Artist'],durationMs:180000}};
test('host outages, revoked sessions, auth failures and throttling remain distinct',async()=>{
 for(const [status,body,type,reason] of [[503,'<html>Service Suspended</html>','text/html','audio-worker-unavailable'],[503,JSON.stringify({reason:'audio-worker-session-unavailable',retryable:false}),'application/json','audio-worker-session-unavailable'],[401,'Unauthorized','text/plain','audio-worker-authentication-failed'],[429,'Slow down','text/plain','audio-worker-busy']] as const){
  const discovery=new WorkerAudioDiscovery({url:'https://worker.example',secret:'synthetic-audit',primaryBot:'examplebot'},async()=>new Response(body,{status,headers:{'Content-Type':type}}));
  const result=await discovery.discover(recording);assert.equal(result.status,'unavailable');if(result.status==='unavailable')assert.equal(result.reason,reason);
 }
});
test('persisted job source reasons explain infrastructure failure without exposing server internals',()=>{
 for(const reason of ['audio-worker-unavailable','audio-worker-session-unavailable','audio-worker-disabled','audio-worker-not-configured','audio-worker-restarting']){
  const issue=responseIssue(503,{status:'unavailable',reason:'no-ready-audio',sourceReason:reason,retryable:true},'download');
  assert.equal(issue.kind,'connection');assert.deepEqual(userIssue(issue.message,'download'),issue);
 }
 assert.equal(responseIssue(503,{reason:'no-ready-audio',sourceReason:'audio-worker-busy'},'download').kind,'busy');
 assert.equal(responseIssue(503,{reason:'no-ready-audio',sourceReason:'audio-source-unavailable'},'download').kind,'missing');
});
test('Chinese instrumental labels agree with instrumental tags and reject vocal recordings',()=>{
 for(const marker of ['伴奏','伴奏版']){
  assert.ok(parseRecordingTitle(`Example (${marker})`).version.kinds.includes('instrumental'));
  const request={metadata:{...recording.metadata,title:`Example (${marker})`}};
  assert.equal(assessAudioCandidate(request,{candidateId:'1',audioKind:'full',metadata:{...recording.metadata,title:'Example (Instrumental)'}}).acceptable,true);
  assert.equal(assessAudioCandidate(request,{candidateId:'1',audioKind:'full',metadata:recording.metadata}).acceptable,false);
 }
});
