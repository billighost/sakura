import assert from "node:assert/strict";
import {test} from "node:test";
import {ScreenActionScope} from "../src/rebuild/app/screenActions";

test("repeated actions share a synchronous screen lock until completion",()=>{
 const scope=new ScreenActionScope(),first=scope.begin("create");assert.ok(first);
 assert.equal(scope.begin("create"),null);assert.ok(scope.begin("rename"));
 assert.equal(scope.current("create",first),true);assert.equal(scope.finish("create",first),true);
 assert.ok(scope.begin("create"));assert.equal(scope.current("create",first),false);
});
test("unmount and account replacement abort all actions and reject stale results",()=>{
 const old=new ScreenActionScope(),preview=old.begin("preview"),more=old.begin("more");assert.ok(preview);assert.ok(more);
 old.dispose();assert.equal(preview.signal.aborted,true);assert.equal(more.signal.aborted,true);
 assert.equal(old.current("preview",preview),false);assert.equal(old.finish("preview",preview),false);assert.equal(old.begin("preview"),null);
 const next=new ScreenActionScope();assert.ok(next.begin("preview"));
});
test("cancellation releases the button only when its aborted request has finished",()=>{
 const scope=new ScreenActionScope(),first=scope.begin("refresh");assert.ok(first);
 scope.cancel("refresh");assert.equal(first.signal.aborted,true);assert.equal(scope.current("refresh",first),false);
 assert.equal(scope.begin("refresh"),null);assert.equal(scope.finish("refresh",first),true);assert.ok(scope.begin("refresh"));
});
test("Strict Mode activation never accepts a result from its disposed lifecycle",()=>{
 const scope=new ScreenActionScope(),first=scope.begin("import");assert.ok(first);scope.dispose();scope.activate();
 const second=scope.begin("import");assert.ok(second);assert.equal(scope.current("import",first),false);
 assert.equal(scope.finish("import",first),false);assert.equal(scope.current("import",second),true);
});
