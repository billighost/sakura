import { MusicScreens } from "@/rebuild/app/MusicScreens";
import { entityPageMetadata } from "@/rebuild/seo/entity";
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
 const { id } = await params;
 return entityPageMetadata("track", id);
}
export default async function Page({params}:{params:Promise<{id:string}>}) { const paramsValue=await params;let id=paramsValue.id;try{id=decodeURIComponent(id);}catch{} return <MusicScreens route={["track",id]}/>; }
