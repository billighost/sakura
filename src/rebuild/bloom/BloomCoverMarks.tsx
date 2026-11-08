import type {BloomListeningProfile} from "./uiTypes";
import type {BloomWorldId} from "./worlds/types";

/** Small static annotations keep archive covers personal without mounting a world. */
export function BloomCoverMarks({world,listening}:{world:BloomWorldId;listening?:BloomListeningProfile}){
 if(!listening)return null;
 const returns=Math.min(6,listening.returningRecordingCount||0),newSongs=Math.min(6,listening.discoveredRecordingCount||0),artists=Math.min(6,listening.returningArtistCount||0),genres=Math.min(6,listening.genreCount||0);
 if(!returns&&!newSongs&&!artists&&!genres)return null;
 const marks=(count:number,draw:(i:number)=>React.ReactNode)=>Array.from({length:count},(_,i)=><g key={i}>{draw(i)}</g>);
 let art;
 switch(world){
  case "sakura":art=<>{marks(returns,i=><g transform={`translate(${18+i*17} 48)`}><path d="M0 7Q-10 0 0-6Q10 0 0 7Z"/><path d="M7 7Q-3 0 7-6Q17 0 7 7Z"/></g>)}{marks(newSongs,i=><circle cx={22+i*17} cy={75} r="2"/>)}</>;break;
  case "jungle":art=<>{marks(genres,i=><path d={`M${10+i*20} 85Q${35+i*15} 50 ${15+i*20} 22`} opacity={.3+(listening.genres?.[i]?.share||0)}/>) }{marks(newSongs,i=><ellipse cx={24+i*18} cy={65-i%2*12} rx="6" ry="2"/>)}</>;break;
  case "disco":art=<>{marks(artists,i=><path d={`M${12+i*19} 85L${22+i*19} 25L${32+i*19} 85Z`}/>)}{marks(newSongs,i=><rect x={13+i*19} y="65" width="11" height="11" transform={`rotate(-12 ${18+i*19} 70)`}/>)}</>;break;
  case "japan":art=<>{marks(newSongs,i=><g transform={`translate(${18+i*18} ${55+i%2*12})`}><path d="M-5-6H5L7 6H-7ZM0-10V-6M0 6V10"/></g>)}{marks(artists,i=><path d={`M${15+i*20} 20v14l4-3 4 3V20Z`}/>)}</>;break;
  case "china":art=<>{marks(returns,i=><path d={`M${12+i*19} 85Q${36+i*15} 55 ${16+i*19} 20M${16+i*19} 85Q${40+i*15} 55 ${20+i*19} 20`}/>)}{marks(newSongs,i=><path d={`M${18+i*18} 58l8 5 8-5Z`}/>)}</>;break;
  case "korea":art=<>{marks(returns,i=><path d={`M${12+i*18} 30h12v42H${12+i*18}ZM${15+i*18} 30v42`}/>)}{marks(newSongs,i=><path d={`M${16+i*18} 28v15l3-2 3 2V28`}/>)}</>;break;
  case "india":art=<>{marks(genres,i=><ellipse cx={22+i*18} cy="75" rx="7" ry={3+(listening.genres?.[i]?.share||0)*8}/>)}{marks(returns,i=><path d={`M${22+i*18} 55q-9-3 0-13q9 10 0 13Z`}/>)}</>;break;
  case "ocean":art=<>{marks(returns,i=><path d={`M${8+i*19} 65q17-28 25-9t-20 11`}/>)}{marks(newSongs,i=><path d={`M${18+i*18} 87q-7-15 0-15q7 0 0 15ZM${18+i*18} 74v11`}/>)}</>;break;
  case "cosmos":art=<>{marks(artists,i=><path d={`M${16+i*19} ${35+i%2*23}l19 ${i%2?-23:23}`}/>)}{marks(newSongs,i=><path d={`M${18+i*19} ${60-i%2*23}l3-7 3 7-3 7Z`}/>)}</>;break;
  case "glass":art=<>{marks(genres,i=><path d={`M${18+i*18} 83V25M${18+i*18} 60q-14-16 0-18q14 2 0 18Z`}/>)}{marks(artists,i=><circle cx={18+i*18} cy="72" r="3"/>)}</>;break;
 }
 return <svg viewBox="0 0 140 100" data-bloom-cover-listening={world} aria-hidden="true" style={{position:"absolute",right:"4%",bottom:"4%",width:"28%",height:"30%",pointerEvents:"none",color:"#f8edcf",filter:"drop-shadow(0 1px 2px #162f35)",opacity:.78}}><g fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round">{art}</g></svg>;
}
