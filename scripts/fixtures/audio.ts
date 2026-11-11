// Generated PCM silence makes container tests independent of remote services,
// third-party recordings, and invalid fake buffers labelled as MP3.
export function waveAudio(durationMs=191000,title?:string,artist?:string):Buffer {
 const samples=Math.round(durationMs*8),rate=8000;
 const pcm=Buffer.alloc(samples,128),format=Buffer.alloc(16);
 format.writeUInt16LE(1,0);format.writeUInt16LE(1,2);format.writeUInt32LE(rate,4);format.writeUInt32LE(rate,8);format.writeUInt16LE(1,12);format.writeUInt16LE(8,14);
 const chunk=(id:string,body:Buffer)=>{const header=Buffer.alloc(8);header.write(id);header.writeUInt32LE(body.length,4);return Buffer.concat([header,body,...(body.length%2?[Buffer.alloc(1)]:[])]);};
 const info=[...(title?[chunk("INAM",Buffer.from(title+"\0"))]:[]),...(artist?[chunk("IART",Buffer.from(artist+"\0"))]:[])];
 const body=Buffer.concat([Buffer.from("WAVE"),chunk("fmt ",format),...(info.length?[chunk("LIST",Buffer.concat([Buffer.from("INFO"),...info]))]:[]),chunk("data",pcm)]);
 const header=Buffer.alloc(8);header.write("RIFF");header.writeUInt32LE(body.length,4);return Buffer.concat([header,body]);
}
