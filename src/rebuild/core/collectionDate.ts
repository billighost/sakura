/** Collection membership dates are contextual; missing dates stay unknown. */
export function collectionDate(value:unknown):string|undefined {
 const stamp=value instanceof Date?value.getTime():typeof value==="number"?value:typeof value==="string"&&value.trim()?Date.parse(value):NaN;
 if(!Number.isFinite(stamp))return;
 const date=new Date(stamp);
 return Number.isFinite(date.getTime())?date.toISOString():undefined;
}
