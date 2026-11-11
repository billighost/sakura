import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectFullAudio} from '../src/rebuild/server/audio-inspection';
import {waveAudio} from './fixtures/audio';
import type {CanonicalRecording} from '../src/rebuild/core/types';
import type {StoredAudioAsset} from '../src/rebuild/server/contracts';
const recording:CanonicalRecording={recordingId:'synthetic',metadata:{title:'Example',artists:['Artist'],durationMs:191000}};
const source={candidate:{candidateId:'synthetic',metadata:recording.metadata,audioKind:'full'},mimeType:'audio/wav'} as StoredAudioAsset;
test('complete bytes require a readable container and matching measured duration',async()=>{
 const evidence=await inspectFullAudio(waveAudio(),recording,source);assert.equal(evidence.durationMs,191000);
 await assert.rejects(inspectFullAudio(Buffer.from('html or arbitrary exact-length bytes'),recording,source));
 await assert.rejects(inspectFullAudio(waveAudio(30000),recording,source),/duration/);
});
test('embedded wrong title, wrong performer and alternate version block promotion',async()=>{
 await inspectFullAudio(waveAudio(191000,'Example','Artist'),recording,source);
 for(const [title,artist] of [['Different','Artist'],['Example','Other'],['Example (Remix)','Artist']])await assert.rejects(inspectFullAudio(waveAudio(191000,title,artist),recording,source),/metadata/);
});
