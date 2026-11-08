import { validTimeZone } from "../bloom/calendar";
import { AUDIO_TECHNOLOGIES } from "../audio/presets";
import { FEED_DEFAULTS, FEED_NUMERIC_FIELDS, FEED_BOOLEAN_FIELDS } from "../app/feedPreferences";
export class ProductError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = "ProductError"; }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProductError(400, "Expected an object");
  return value as Record<string, unknown>;
}
export function uuid(value: unknown, label = "ID"): string {
  if (typeof value !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) throw new ProductError(400, `Invalid ${label}`);
  return value.toLowerCase();
}
export function text(value: unknown, label: string, max: number, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim()) || value.length > max) throw new ProductError(400, `Invalid ${label}`);
  return value.trim();
}
export function integer(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new ProductError(400, `Invalid ${label}`);
  return value;
}
export function strings(value: unknown, label: string, limit: number, maxLength = 120): string[] {
  if (!Array.isArray(value) || value.length > limit) throw new ProductError(400, `Invalid ${label}`);
  return [...new Set(value.map(v => text(v,label,maxLength)))];
}
export function ids(value: unknown, limit = 200): string[] {
  if (!Array.isArray(value) || value.length > limit) throw new ProductError(400,"Invalid recording list");
  const parsed = value.map(v=>uuid(v,"recording ID"));
  if (new Set(parsed).size !== parsed.length) throw new ProductError(400,"Duplicate recording IDs");
  return parsed;
}
export const DEFAULT_SETTINGS = {
  theme: "system", audioQuality: "high", audioTechnology: "none", privateSession: false, ...FEED_DEFAULTS,
  reducedMotion: false, openingAnimation: 1, bloomPerformance: "auto", explicitContent: true,
  timeZone: "Africa/Lagos", seedArtistSelections: [],volume:.8,shuffle:false,repeat:"off",previewVolume:.8,previewLoop:true,sleepTimerMinutes:15,
} as const;
export function preferencesPatch(value: unknown): Record<string,unknown> {
  const raw = object(value), result: Record<string,unknown> = {};
  const choices: Record<string,readonly string[]> = { theme:["system","dark","light"], bloomPerformance:["auto","1","2","3","4","5"], audioQuality:["high","balanced","data-saver"], audioTechnology:AUDIO_TECHNOLOGIES.map(mode=>mode.id),repeat:["off","one","all"] };
  const booleans = ["privateSession","reducedMotion","explicitContent","shuffle","previewLoop",...FEED_BOOLEAN_FIELDS];
  const allowed = new Set([...Object.keys(choices),...booleans,...FEED_NUMERIC_FIELDS,"openingAnimation","seedArtists","seedArtistSelections","seedGenres","onboarded","timeZone","volume","previewVolume","sleepTimerMinutes"]);
  if (Object.keys(raw).some(key=>!allowed.has(key))) throw new ProductError(400,"Unsupported setting");
  for (const [key,values] of Object.entries(choices)) if (raw[key] !== undefined) {
    if (typeof raw[key] !== "string" || !values.includes(raw[key] as string)) throw new ProductError(400,`Invalid ${key}`);
    result[key] = raw[key];
  }
  for (const key of booleans) if (raw[key] !== undefined) {
    if (typeof raw[key] !== "boolean") throw new ProductError(400,`Invalid ${key}`);
    result[key] = raw[key];
  }
  for (const key of FEED_NUMERIC_FIELDS) if (raw[key] !== undefined) {
    const value = raw[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new ProductError(400,`Invalid ${key} preference`);
    result[key] = value;
  }
  if (raw.openingAnimation !== undefined) result.openingAnimation = integer(raw.openingAnimation,"opening animation",0,4);
  for(const key of ["volume","previewVolume"])if(raw[key]!==undefined){if(typeof raw[key]!=="number"||!Number.isFinite(raw[key])||raw[key]<0||raw[key]>1)throw new ProductError(400,`Invalid ${key}`);result[key]=raw[key];}
  if(raw.sleepTimerMinutes!==undefined)result.sleepTimerMinutes=integer(raw.sleepTimerMinutes,"sleep timer minutes",1,180);
  if (raw.seedArtists !== undefined) result.seedArtists = strings(raw.seedArtists,"seed artists",20);
  if(raw.timeZone!==undefined){if(!validTimeZone(raw.timeZone))throw new ProductError(400,"Invalid timezone");result.timeZone=raw.timeZone;}
  if(raw.seedArtistSelections!==undefined){
    if(!Array.isArray(raw.seedArtistSelections)||raw.seedArtistSelections.length>20)throw new ProductError(400,"Invalid artist selections");
    const selections=raw.seedArtistSelections.map(value=>{
      const choice=object(value),ref=object(choice.reference),name=text(choice.name,"artist name",120);
      if(!["deezer","spotify"].includes(String(ref.provider)))throw new ProductError(400,"Invalid artist provider");
      const id=text(ref.id,"artist reference",80);
      if((ref.provider==="deezer"&&!/^[1-9]\d{0,17}$/.test(id))||(ref.provider==="spotify"&&!/^[A-Za-z0-9]{22}$/.test(id)))throw new ProductError(400,"Invalid artist reference");
      return {name,reference:{provider:ref.provider,id},selectionKey:`artist:${ref.provider}:${id}`};
    });
    result.seedArtistSelections=[...new Map(selections.map(s=>[s.selectionKey,s])).values()];
    // Existing clients use names; keep those preferences coherent when exact
    // choices arrive without the legacy field.
    if(raw.seedArtists===undefined)result.seedArtists=[...new Set(selections.map(s=>s.name))];
  }
  if (raw.seedGenres !== undefined) result.seedGenres = strings(raw.seedGenres,"seed genres",12,80);
  if (raw.onboarded !== undefined) {
    if (typeof raw.onboarded !== "boolean") throw new ProductError(400,"Invalid onboarding state");
    result.onboarded = raw.onboarded;
  }
  return result;
}

export interface PageCursor { timestamp: string; id: string }
export function encodeCursor(timestamp: Date | string,id: string): string {
  return Buffer.from(JSON.stringify({timestamp:new Date(timestamp).toISOString(),id})).toString("base64url");
}
export function pageInput(url: URL): { limit: number; cursor: PageCursor | null } {
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null ? 50 : integer(Number(rawLimit),"page size",1,100);
  const raw = url.searchParams.get("cursor");
  let cursor: PageCursor | null = null;
  if (raw) {
    try {
      if (raw.length > 300) throw new Error();
      const parsed = object(JSON.parse(Buffer.from(raw,"base64url").toString("utf8")));
      const timestamp = text(parsed.timestamp,"cursor date",40), id = uuid(parsed.id,"cursor ID");
      if (!Number.isFinite(Date.parse(timestamp))) throw new Error();
      cursor = { timestamp:new Date(timestamp).toISOString(),id };
    } catch { throw new ProductError(400,"Invalid page cursor"); }
  }
  return { limit,cursor };
}
