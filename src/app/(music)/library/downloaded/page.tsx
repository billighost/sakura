import { MusicScreens } from "@/rebuild/app/MusicScreens";
import { staticPageMetadata } from "@/rebuild/seo/metadata";
export const metadata = staticPageMetadata("downloads");
export default function Page() { return <MusicScreens route={["library", "downloaded"]}/>; }
