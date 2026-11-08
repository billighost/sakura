/* eslint-disable @typescript-eslint/no-require-imports -- Pure deployable CommonJS queue regression tests. */
const {test}=require("node:test"),assert=require("node:assert/strict");
const {SerialQueue}=require("./serial-queue.cjs");
test("a failed conversation releases its chat queue and preserves FIFO",async()=>{
 const queue=new SerialQueue("chat"),order=[];
 const first=queue.run(async()=>{order.push("first");throw new Error("bot unavailable");});
 const second=queue.run(async()=>{order.push("second");return"ready";});
 await assert.rejects(first,/bot unavailable/);assert.equal(await second,"ready");assert.deepEqual(order,["first","second"]);
});
test("queued expiration returns promptly and never sends the expired bot query",async()=>{
 const queue=new SerialQueue("chat");let release,expiredRan=false;
 const active=queue.run(()=>new Promise(resolve=>{release=resolve;}));
 await Promise.resolve();
 const expired=queue.run(()=>{expiredRan=true;},{deadline:Date.now()+20});
 await assert.rejects(expired,/queue deadline/);assert.equal(queue.depth,1);assert.equal(expiredRan,false);
 release();await active;await queue.run(()=>{});assert.equal(expiredRan,false);
});
test("independent bot queues run while another chat is busy",async()=>{
 const primary=new SerialQueue("primary"),fallback=new SerialQueue("fallback");let release;
 const pending=primary.run(()=>new Promise(resolve=>{release=resolve;}));await Promise.resolve();
 assert.equal(await fallback.run(()=>"ready"),"ready");assert.equal(primary.depth,1);release();await pending;
});
test("higher priority waiting work runs first without interrupting an active conversation",async()=>{
 const queue=new SerialQueue("chat"),order=[];let release;
 const active=queue.run(()=>new Promise(resolve=>{release=resolve;order.push("active");}));await Promise.resolve();
 const ordinary=queue.run(()=>order.push("ordinary"));
 const playback=queue.run(()=>order.push("playback"),{priority:10});release();
 await Promise.all([active,ordinary,playback]);assert.deepEqual(order,["active","playback","ordinary"]);
});

test("expired queued work is skipped even before a delayed timeout callback fires",async()=>{
 const queue=new SerialQueue("chat");let release,ran=false;
 const active=queue.run(()=>new Promise(resolve=>{release=resolve;}));await Promise.resolve();
 const deadline=Date.now()+10,pending=queue.run(()=>{ran=true;},{deadline});
 while(Date.now()<=deadline){/* Delay timers, as a busy Node event loop can. */}
 release();await active;await assert.rejects(pending,/queue deadline/);assert.equal(ran,false);
});
