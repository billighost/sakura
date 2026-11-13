import { MusicScreens } from "@/rebuild/app/MusicScreens";
import { staticPageMetadata } from "@/rebuild/seo/metadata";
export const metadata = staticPageMetadata("liked");
export default function Page() { return <MusicScreens route={["liked"]}/>; }
