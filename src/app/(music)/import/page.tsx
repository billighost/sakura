import { MusicScreens } from "@/rebuild/app/MusicScreens";
import { staticPageMetadata } from "@/rebuild/seo/metadata";
export const metadata = staticPageMetadata("import");
export default function Page() { return <MusicScreens route={["import"]}/>; }
