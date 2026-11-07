import { MusicScreens } from "@/rebuild/app/MusicScreens";
export const instant = false;
export default async function Page({params}:{params:Promise<{id:string}>}) { const paramsValue=await params;let id=paramsValue.id;try{id=decodeURIComponent(id);}catch{} return <MusicScreens route={["track",id]}/>; }
