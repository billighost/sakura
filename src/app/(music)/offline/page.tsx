import { MusicScreens } from "@/rebuild/app/MusicScreens";
import { staticPageMetadata } from "@/rebuild/seo/metadata";
export const metadata = staticPageMetadata("offline");
export default function Page() { return <MusicScreens route={["offline"]}/>; }
