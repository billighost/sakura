import { InfoPage } from "@/rebuild/app/InfoPage";
import { staticPageMetadata } from "@/rebuild/seo/metadata";
export const metadata = staticPageMetadata("about");
export default function Page(){return <InfoPage kind="about"/>;}
