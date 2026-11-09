import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_ROOM_PRESENTATION, mergeRoomPresentation, roomPresentation, storedRoomPresentation } from "../src/rebuild/app/collectionPresentation";
import { collectionRoom, collectionView } from "../src/rebuild/data/collectionViews";
import { ProductError } from "../src/rebuild/data/validation";

test("collection presentation accepts only complete known layout and sorting choices",()=>{
 assert.deepEqual(roomPresentation({layout:"cards",sort:"artist",direction:"desc"}),{layout:"cards",sort:"artist",direction:"desc"});
 for(const value of [null,{}, {layout:"tiles",sort:"artist",direction:"desc"},{layout:"list",sort:"random",direction:"asc"},{layout:"compact",sort:"title",direction:"backward"}])assert.equal(roomPresentation(value),null);
});

test("local presentation records reject damaged timestamps and preserve valid server receipts",()=>{
 assert.deepEqual(storedRoomPresentation({layout:"compact",sort:"duration",direction:"asc",savedAt:12,pending:false,serverUpdatedAt:"2026-11-09T10:00:00.000Z"}),{layout:"compact",sort:"duration",direction:"asc",savedAt:12,pending:false,serverUpdatedAt:"2026-11-09T10:00:00.000Z"});
 assert.equal(storedRoomPresentation({layout:"list",sort:"kept",direction:"asc",savedAt:-1,pending:false}),null);
 assert.equal(storedRoomPresentation({layout:"list",sort:"kept",direction:"asc",savedAt:1,pending:"yes"}),null);
});

test("partial control changes retain the other room choices",()=>{
 assert.deepEqual(mergeRoomPresentation(DEFAULT_ROOM_PRESENTATION,{layout:"cards"}),{layout:"cards",sort:"kept",direction:"asc"});
 assert.deepEqual(mergeRoomPresentation({layout:"cards",sort:"title",direction:"desc"},{sort:"added"}),{layout:"cards",sort:"added",direction:"desc"});
 assert.deepEqual(mergeRoomPresentation(DEFAULT_ROOM_PRESENTATION,{layout:"unknown" as "list"}),DEFAULT_ROOM_PRESENTATION);
});

test("server collection views validate bounded room identities and the same choices as the client",()=>{
 assert.equal(collectionRoom("playlist:42"),"playlist:42");
 assert.deepEqual(collectionView({layout:"cards",sort:"added",direction:"desc",room:"ignored"}),{layout:"cards",sort:"added",direction:"desc"});
 assert.throws(()=>collectionRoom(" "),(error:unknown)=>error instanceof ProductError&&error.status===400);
 assert.throws(()=>collectionRoom("x".repeat(181)),(error:unknown)=>error instanceof ProductError&&error.status===400);
 assert.throws(()=>collectionView({layout:"cards",sort:"shuffle",direction:"asc"}),(error:unknown)=>error instanceof ProductError&&error.status===400);
});
