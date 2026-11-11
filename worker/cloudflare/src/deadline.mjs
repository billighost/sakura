export async function withDeadline(work, ms, expire) {
 let timer;
 try { return await Promise.race([work, new Promise((_,reject) => { timer=setTimeout(()=>{expire();reject(new Error('TIMEOUT'));},ms); })]); }
 finally { clearTimeout(timer); }
}
export function guardSender(sender, expire, ms=15000) {
 if(sender.__sakuraGuarded)return sender;
 sender.__sakuraGuarded=true;
 const add=sender.addStateToQueue.bind(sender),send=sender.send.bind(sender);
 sender.send=request=>withDeadline(send(request),ms,expire);
 sender.addStateToQueue=state=>{
  const timer=setTimeout(()=>{state.reject(new Error('TIMEOUT'));expire();},ms);
  state.promise.then(()=>clearTimeout(timer),()=>clearTimeout(timer));
  add(state);
 };
 return sender;
}
export function guardClientSenders(client, isCurrent, expire) {
 const create=client._createExportedSender.bind(client),get=client.getSender.bind(client);
 client._createExportedSender=dc=>guardSender(create(dc),expire);
 client.getSender=async dc=>{
  if(!isCurrent()||client._destroyed)throw new Error('Telegram client retired');
  // No second main connection when upload.getFile addresses our own DC.
  return !dc||dc===client.session.dcId?client._sender:withDeadline(get(dc),20000,expire);
 };
}
