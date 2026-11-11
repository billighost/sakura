"use client";
import dynamic from "next/dynamic";
import { useMusic } from "./MusicContext";
import { Empty, LoadingRows } from "./Elements";

// Keep the neutral offline renderer self-contained, including its namespace
// bridge; client-reference HTML alone does not list every dynamic import chunk.
import { Downloads } from "./MusicDownloadsScreen";

// Share each import site with active-page preloading to fetch one chunk group.
const screens={
 home:()=>import("./MusicHomeScreen").then(module=>module.Home),
 discover:()=>import("./MusicHomeScreen").then(module=>module.Discover),
 search:()=>import("./MusicSearchScreen").then(module=>module.Search),
 library:()=>import("./MusicLibraryScreen").then(module=>module.Library),
 collection:()=>import("./MusicCollectionScreen").then(module=>module.Collection),
 track:()=>import("./MusicCollectionScreen").then(module=>module.TrackDetails),
 profile:()=>import("./ListeningProfile").then(module=>module.ListeningProfile),
 settings:()=>import("./MusicSettingsScreen").then(module=>module.Settings),
 onboarding:()=>import("./MusicOnboardingScreen").then(module=>module.Onboarding),
 import:()=>import("./MusicImportScreen").then(module=>module.Import),
};
const Home=dynamic(screens.home,{loading:LoadingRows});
const Discover=dynamic(screens.discover,{loading:LoadingRows});
const Search=dynamic(screens.search,{loading:LoadingRows});
const Library=dynamic(screens.library,{loading:LoadingRows});
const Collection=dynamic(screens.collection,{loading:LoadingRows});
const TrackDetails=dynamic(screens.track,{loading:LoadingRows});
const Profile=dynamic(screens.profile,{loading:LoadingRows});
const Settings=dynamic(screens.settings,{loading:LoadingRows});
const Onboarding=dynamic(screens.onboarding,{loading:LoadingRows});
const Import=dynamic(screens.import,{loading:LoadingRows});

/** Import only the selected screen while account data is booting. */
export function preloadMusicScreen(pathname:string):Promise<unknown>{
 const section=pathname.split("/")[1];
 switch(section){
  case "home":return screens.home();
  case "discover":return screens.discover();
  case "search":return screens.search();
  case "liked":return screens.library();
  case "library":return pathname.includes("/downloaded")?Promise.resolve():screens.library();
  case "playlist":case "mix":case "album":case "artist":return screens.collection();
  case "track":return screens.track();
  case "profile":return screens.profile();
  case "settings":return screens.settings();
  case "onboarding":return screens.onboarding();
  case "import":return screens.import();
  default:return Promise.resolve();
 }
}

export function MusicScreens({route}:{route:string[]}){const {account}=useMusic();const path=route.join("/"),key=(account?.id||"guest")+":"+path;if(path==="home")return <Home key={key}/>;if(path==="search")return <Search key={key}/>;if(path==="discover")return <Discover key={key}/>;if(path==="library")return <Library key={key}/>;if(path==="liked")return <Library key={key} likedOnly/>;if(path==="library/downloaded"||path==="downloads"||path==="offline")return <Downloads key={key}/>;if(path==="profile")return <Profile key={key}/>;if(path==="settings")return <Settings key={key}/>;if(path==="onboarding")return <Onboarding key={key}/>;if(path==="import")return <Import key={key}/>;if(["playlist","mix","album","artist"].includes(route[0])&&route[1])return <Collection key={key} kind={route[0] as "playlist"|"mix"|"album"|"artist"} id={route[1]}/>;if(route[0]==="track"&&route[1])return <TrackDetails key={key} id={route[1]}/>;return <Empty title="This page has moved." href="/home" action="Go to Home"/>;}
