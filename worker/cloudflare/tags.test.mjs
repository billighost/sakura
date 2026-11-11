import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {recoverEmbeddedMetadata} from './src/tags.mjs';
function taggedMp3(title,artist,artworkBytes=0){
 const frame=(id,text)=>{const body=Buffer.concat([Buffer.from([3]),Buffer.from(text)]),header=Buffer.alloc(10);header.write(id);header.writeUInt32BE(body.length,4);return Buffer.concat([header,body]);};
 const tags=Buffer.concat([frame('TIT2',title),frame('TPE1',artist),...(artworkBytes?[frame('APIC','\0image/jpeg\0\u0003\0'+'x'.repeat(artworkBytes))]:[])]),header=Buffer.from([0x49,0x44,0x33,3,0,0,0,0,0,0]);let size=tags.length;for(let i=9;i>=6;i--){header[i]=size&127;size>>=7;}
 const mpeg=Buffer.alloc(417);mpeg.set([0xff,0xfb,0x90,0]);return Buffer.concat([header,tags,...Array(10).fill(mpeg)]);
}
test('bounded MP3 prefix recovers actual full tags even when the whole file is much larger',async()=>{
 const bytes=taggedMp3('Complete original title','Complete performer');
 const audio={metadata:{title:'Complete original…',artists:['Complete performer'],durationMs:180000},mimeType:'audio/mpeg',size:8*1024*1024};
 const metadata=await recoverEmbeddedMetadata(audio,Readable.from([bytes]));assert.equal(metadata.title,'Complete original title');assert.deepEqual(metadata.artists,['Complete performer']);assert.equal(metadata.durationMs,180000);
 const invalid=await recoverEmbeddedMetadata(audio,Readable.from([taggedMp3('Still incomplete…','Complete performer')]));assert.equal(invalid,null);
});
test('embedded artwork larger than the original 256 KiB probe does not hide complete title and artist tags',async()=>{
 const bytes=taggedMp3('Full instrumental (伴奏版)','Performer',360000);
 const audio={metadata:{title:'Full instrumental…',artists:['Performer'],durationMs:192000},mimeType:'audio/mpeg',size:8*1024*1024};
 await assert.rejects(recoverEmbeddedMetadata(audio,Readable.from([bytes.subarray(0,256*1024)])),/tag size/);
 const recovered=await recoverEmbeddedMetadata(audio,Readable.from([bytes]));assert.equal(recovered.title,'Full instrumental (伴奏版)');assert.deepEqual(recovered.artists,['Performer']);
});
