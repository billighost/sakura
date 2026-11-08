/** A bot conversation is indivisible. Waiting work can expire without
 * interrupting an active conversation or delaying independent chat queues. */
class SerialQueue {
 constructor(label){this.label=label;this.depth=0;this.waiting=[];this.active=false;this.sequence=0;}
 run(fn,{deadline,priority=0}={}){
  if(deadline!==undefined&&deadline<=Date.now())return Promise.reject(new Error("Bot queue deadline exceeded"));
  return new Promise((resolve,reject)=>{
   const task={fn,resolve,reject,deadline,priority,sequence:this.sequence++,timer:null};
   this.depth++;this.waiting.push(task);
   if(deadline!==undefined)task.timer=setTimeout(()=>{
    const at=this.waiting.indexOf(task);if(at<0)return;
    this.waiting.splice(at,1);this.depth--;reject(new Error("Bot queue deadline exceeded"));
   },Math.max(1,deadline-Date.now()));
   this.pump();
  });
 }
 pump(){
  if(this.active||!this.waiting.length)return;
  this.waiting.sort((a,b)=>b.priority-a.priority||a.sequence-b.sequence);
  while(this.waiting.length){
   const task=this.waiting.shift();if(task.timer)clearTimeout(task.timer);
   if(task.deadline!==undefined&&task.deadline<=Date.now()){this.depth--;task.reject(new Error("Bot queue deadline exceeded"));continue;}
   this.active=true;
   Promise.resolve().then(task.fn).then(task.resolve,task.reject).finally(()=>{this.depth--;this.active=false;this.pump();});
   return;
  }
 }
}
module.exports={SerialQueue};
