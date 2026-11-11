/** Reading rules change pronunciation, not the verified identity of saved words. */
export function stableLyricCacheIdentity(key:string){
 try{
  const identity:unknown=JSON.parse(key);
  if(Array.isArray(identity)&&typeof identity[1]==="string"&&typeof identity[2]==="string"&&Array.isArray(identity[3]))return JSON.stringify([identity[0],...identity.slice(2)]);
 }catch{}
 return key;
}
