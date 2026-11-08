import type { Metadata, Viewport } from "next";
import { Inter, Fraunces } from "next/font/google";
import { Pwa } from "@/rebuild/app/Pwa";
import "./globals.css";
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", display: "swap", preload: false });
export const metadata: Metadata = {
 title: { default: "Sakura — your little music world", template: "%s · Sakura" },
 description: "Music, with room to breathe. A personal music world in Sakura Ink.",
 manifest: "/manifest.json", referrer: "no-referrer",
 icons: { icon: "/icons/ink.svg", apple: "/icons/ink-180.png" },
 appleWebApp: { capable: true, statusBarStyle: "default", title: "Sakura" },
};
export const viewport: Viewport = {
 width: "device-width", initialScale: 1, minimumScale: 1, maximumScale: 1, userScalable: false, viewportFit: "cover",
 themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f5f5ee" }, { media: "(prefers-color-scheme: dark)", color: "#18241f" }],
};
const bootScript = `(function(){var t='system',o=1;try{var a=localStorage.getItem('sakura-v2-active-account'),p=a&&localStorage.getItem('sakura-v2-preferences:'+a),v=p?JSON.parse(p):null,c=a?v&&v.settings&&v.settings.theme:localStorage.getItem('sakura-v2-theme');if(c==='dark'||c==='light'||c==='system')t=c;if(v&&v.settings&&Number.isInteger(v.settings.openingAnimation))o=v.settings.openingAnimation}catch(e){}document.documentElement.dataset.inkTheme=t==='dark'||t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';try{if(o!==0&&sessionStorage.getItem('sakura-ink-opening')!=='1'){document.documentElement.dataset.sakuraOpening='pending';document.documentElement.style.setProperty('--sakura-opening-display','flex')}}catch(e){if(o!==0){document.documentElement.dataset.sakuraOpening='pending';document.documentElement.style.setProperty('--sakura-opening-display','flex')}}})()`;
export default function RootLayout({ children }: { children: React.ReactNode }) {
 return <html lang="en" className={`${inter.variable} ${fraunces.variable}`} suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: bootScript }}/></head><body><Pwa/>{children}</body></html>;
}
