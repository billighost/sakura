"use client";
import { useMusic } from "./MusicContext";
import { useResource } from "./resources";
import { musicTrack, type MusicTrack } from "./types";
import { LoadingRows, LoadError } from "./Elements";
import { RecoveryNotice } from "./RecoveryNotice";

export type Data=Record<string,unknown>;

export function list(value:unknown):MusicTrack[]{return Array.isArray(value)?value.map(t=>musicTrack(t as Data)):[];}

export function normalizedSearchText(value:string){return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g," ").trim();}

export function useApi(path:string|null){const {account}=useMusic();return useResource<Data>(account?.id||null,path);}

export function ResourceBody({resource,children}:{resource:ReturnType<typeof useApi>;children:React.ReactNode}){return resource.loading&&!resource.data?<LoadingRows/>:resource.error&&!resource.data?<LoadError message={resource.error} retry={resource.retry}/>:<>{resource.error&&resource.data&&<RecoveryNotice compact error={resource.error} retry={resource.retry}/>} {children}</>;}
