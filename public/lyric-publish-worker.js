/* LRCLIB's LRCGET protocol: SHA-256(prefix + decimal nonce) <= target.
 * Work stays off the UI thread and terminates before the five-minute expiry.
 * Reference: https://lrclib.net/docs.md and LRCGET challenge_solver.rs. */
"use strict";
const rounds = new Uint32Array([
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
]);
const initial = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
const rotate = (value, by) => (value >>> by) | (value << (32-by));
function nonceHasher(prefix) {
  const words = new Uint32Array(64), block = new Uint32Array(80), digest = new Uint32Array(8);
  for (let i=0;i<prefix.length;i++) block[i>>>2] |= prefix.charCodeAt(i) << (24-(i%4)*8);
  const fixed = block.slice();
  return nonce => {
    block.set(fixed); const decimal=String(nonce), length=prefix.length+decimal.length;
    for(let i=0;i<decimal.length;i++){const at=prefix.length+i;block[at>>>2] |= decimal.charCodeAt(i) << (24-(at%4)*8);}
    block[length>>>2] |= 0x80 << (24-(length%4)*8);
    const blocks=Math.ceil((length+9)/64);block[blocks*16-1]=length*8;digest.set(initial);
    for(let offset=0;offset<blocks*16;offset+=16){
      for(let i=0;i<16;i++)words[i]=block[offset+i];
      for(let i=16;i<64;i++){const x=words[i-15],y=words[i-2];words[i]=((rotate(x,7)^rotate(x,18)^(x>>>3))+words[i-16]+(rotate(y,17)^rotate(y,19)^(y>>>10))+words[i-7])>>>0;}
      let [a,b,c,d,e,f,g,h]=digest;
      for(let i=0;i<64;i++){
        const one=(h+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^(~e&g))+rounds[i]+words[i])>>>0;
        const two=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c)))>>>0;
        h=g;g=f;f=e;e=(d+one)>>>0;d=c;c=b;b=a;a=(one+two)>>>0;
      }
      digest[0]=(digest[0]+a)>>>0;digest[1]=(digest[1]+b)>>>0;digest[2]=(digest[2]+c)>>>0;digest[3]=(digest[3]+d)>>>0;
      digest[4]=(digest[4]+e)>>>0;digest[5]=(digest[5]+f)>>>0;digest[6]=(digest[6]+g)>>>0;digest[7]=(digest[7]+h)>>>0;
    }
    return digest;
  };
}
function meetsTarget(digest,target){for(let i=0;i<8;i++){if(digest[i]<target[i])return true;if(digest[i]>target[i])return false;}return true;}
self.onmessage = event => {
  const {prefix,target,maximumMs=240000}=event.data||{};
  if(typeof prefix!=="string"||!/^[a-zA-Z0-9_-]{1,256}$/.test(prefix)||typeof target!=="string"||!/^[a-fA-F0-9]{64}$/.test(target)){
    self.postMessage({type:"error",reason:"invalid-challenge"});return;
  }
  const threshold=new Uint32Array(Array.from({length:8},(_,i)=>Number.parseInt(target.slice(i*8,i*8+8),16))), hash=nonceHasher(prefix),start=Date.now();
  const maximum=Math.min(240000,Math.max(1,Number(maximumMs)||240000));
  for(let nonce=0;nonce<Number.MAX_SAFE_INTEGER;nonce++){
    if(nonce%65536===0){const elapsedMs=Date.now()-start;if(elapsedMs>=maximum){self.postMessage({type:"error",reason:"expired"});return;}self.postMessage({type:"progress",attempts:nonce,elapsedMs});}
    if(meetsTarget(hash(nonce),threshold)){self.postMessage({type:"complete",token:`${prefix}:${nonce}`});return;}
  }
  self.postMessage({type:"error",reason:"expired"});
};
