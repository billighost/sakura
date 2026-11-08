import { Suspense, type ReactNode } from "react";
import { MusicProvider } from "@/rebuild/app/MusicContext";
import { InkShell } from "@/rebuild/app/InkShell";
import { RouteTransition } from "@/rebuild/app/NavigationUX";
export default function Layout({ children }: { children: ReactNode }) {
 return <Suspense><MusicProvider><InkShell><RouteTransition>{children}</RouteTransition></InkShell></MusicProvider></Suspense>;
}
