import {createHmac,timingSafeEqual} from "node:crypto";
import {ProductError,integer,object,uuid} from "../data/validation";

export interface FeedCursor {sessionId:string;offset:number;signature:string}
function signature(sessionId:string,offset:number,secret:string):string{
  return createHmac("sha256",secret).update(`sakura-feed-v1:${sessionId}:${offset}`).digest("base64url");
}
export function encodeFeedCursor(sessionId:string,offset:number,secret:string):string{
  return Buffer.from(JSON.stringify({v:1,s:sessionId,o:offset,h:signature(sessionId,offset,secret)})).toString("base64url");
}
/** Cursor syntax is bounded before a database lookup. Signature validation uses the owned session's private key. */
export function parseFeedCursor(raw:string):FeedCursor{
  try{
    if(raw.length>360||!/^[A-Za-z0-9_-]+$/.test(raw))throw new Error();
    const value=object(JSON.parse(Buffer.from(raw,"base64url").toString("utf8")));
    if(value.v!==1||typeof value.h!=="string"||!/^[-_A-Za-z0-9]{43}$/.test(value.h)||Object.keys(value).length!==4)throw new Error();
    return {sessionId:uuid(value.s,"feed session"),offset:integer(value.o,"feed position",0,2500),signature:value.h};
  }catch{throw new ProductError(400,"Invalid feed cursor");}
}
export function verifyFeedCursor(cursor:FeedCursor,secret:string):void{
  const expected=Buffer.from(signature(cursor.sessionId,cursor.offset,secret)),actual=Buffer.from(cursor.signature);
  if(expected.length!==actual.length||!timingSafeEqual(expected,actual))throw new ProductError(400,"Invalid feed cursor");
}
