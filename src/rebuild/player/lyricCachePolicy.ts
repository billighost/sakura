export const LYRIC_WEEK_MS=7*24*60*60*1000;

/** Completed synchronization is retained; plain and empty lookups check for updates weekly. */
export function lyricCacheFresh(timing:"synced"|"plain"|"missing",checkedAt:number,now=Date.now()){
 if(timing==="synced")return true;
 const age=now-checkedAt;
 return Number.isFinite(checkedAt)&&checkedAt>0&&age>=-1000&&age<LYRIC_WEEK_MS;
}

/** Saving pronunciation choices must not postpone the next provider update check. */
export function lyricProviderCheckedAt(value:{savedAt:number;checkedAt?:number},previous?:{savedAt:number;checkedAt?:number}){
 return value.checkedAt??previous?.checkedAt??previous?.savedAt??value.savedAt;
}
