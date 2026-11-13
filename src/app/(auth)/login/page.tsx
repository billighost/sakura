import { Suspense } from "react";
import { AuthForms } from "@/rebuild/app/AuthForms";
import { staticPageMetadata } from "@/rebuild/seo/metadata";
export const metadata = staticPageMetadata("login");
export default function Page(){return <Suspense><AuthForms/></Suspense>;}
