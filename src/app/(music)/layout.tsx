import { Suspense, type ReactNode } from "react";
import { MusicProvider } from "@/rebuild/app/MusicContext";
import { InkShell } from "@/rebuild/app/InkShell";
export default function Layout({ children }: { children: ReactNode }) {
 return <Suspense><MusicProvider><InkShell>{children}</InkShell></MusicProvider></Suspense>;
}
