"use client";
import dynamic from "next/dynamic";
import { useMusic } from "./MusicContext";
import { Empty, LoadingRows } from "./Elements";

// These route-only imports live in a Client Component so Next can split them.
const Home = dynamic(() => import("./MusicHomeScreen").then(module => module.Home), { loading: LoadingRows });
const Discover = dynamic(() => import("./MusicHomeScreen").then(module => module.Discover), { loading: LoadingRows });
const Search = dynamic(() => import("./MusicSearchScreen").then(module => module.Search), { loading: LoadingRows });
const Library = dynamic(() => import("./MusicLibraryScreen").then(module => module.Library), { loading: LoadingRows });
const Downloads = dynamic(() => import("./MusicDownloadsScreen").then(module => module.Downloads), { loading: LoadingRows });
const Collection = dynamic(() => import("./MusicCollectionScreen").then(module => module.Collection), { loading: LoadingRows });
const TrackDetails = dynamic(() => import("./MusicCollectionScreen").then(module => module.TrackDetails), { loading: LoadingRows });
const Profile = dynamic(() => import("./ListeningProfile").then(module => module.ListeningProfile), { loading: LoadingRows });
const Settings = dynamic(() => import("./MusicSettingsScreen").then(module => module.Settings), { loading: LoadingRows });
const Onboarding = dynamic(() => import("./MusicOnboardingScreen").then(module => module.Onboarding), { loading: LoadingRows });
const Import = dynamic(() => import("./MusicImportScreen").then(module => module.Import), { loading: LoadingRows });

/** Fetch only the selected screen while account data is booting. Importing a
 * module does not mount its components or start their resource requests. */
export function preloadMusicScreen(pathname:string){
 const section=pathname.split("/")[1];
 switch(section){
  case "home":case "discover":return import("./MusicHomeScreen");
  case "search":return import("./MusicSearchScreen");
  case "liked":return import("./MusicLibraryScreen");
  case "library":return pathname.includes("/downloaded")?Promise.resolve():import("./MusicLibraryScreen");
  case "playlist":case "mix":case "album":case "artist":case "track":return import("./MusicCollectionScreen");
  case "profile":return import("./ListeningProfile");
  case "settings":return import("./MusicSettingsScreen");
  case "onboarding":return import("./MusicOnboardingScreen");
  case "import":return import("./MusicImportScreen");
  case "bloom":return import("../bloom/BloomPage");
  default:return Promise.resolve();
 }
}

export function MusicScreens({route}:{route:string[]}){const {account}=useMusic();const path=route.join("/"),key=(account?.id||"guest")+":"+path;if(path==="home")return <Home key={key}/>;if(path==="search")return <Search key={key}/>;if(path==="discover")return <Discover key={key}/>;if(path==="library")return <Library key={key}/>;if(path==="liked")return <Library key={key} likedOnly/>;if(path==="library/downloaded"||path==="downloads"||path==="offline")return <Downloads key={key}/>;if(path==="profile")return <Profile key={key}/>;if(path==="settings")return <Settings key={key}/>;if(path==="onboarding")return <Onboarding key={key}/>;if(path==="import")return <Import key={key}/>;if(["playlist","mix","album","artist"].includes(route[0])&&route[1])return <Collection key={key} kind={route[0] as "playlist"|"mix"|"album"|"artist"} id={route[1]}/>;if(route[0]==="track"&&route[1])return <TrackDetails key={key} id={route[1]}/>;return <Empty title="This page has moved." href="/home" action="Go to Home"/>;}
