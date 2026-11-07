import {BloomPage} from "@/rebuild/bloom/BloomPage";
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <BloomPage id={id}/>;}
