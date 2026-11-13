import {BloomPage} from "@/rebuild/bloom/BloomPage";
import { makeShareMetadata, staticOgData, staticOgImagePath } from "@/rebuild/seo/metadata";
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
 const { id } = await params;
 const data = staticOgData("bloom-story");
 return makeShareMetadata({ title: data.label, description: data.description, path: "/bloom/" + encodeURIComponent(id), image: staticOgImagePath("bloom-story") });
}
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <BloomPage id={id}/>;}
