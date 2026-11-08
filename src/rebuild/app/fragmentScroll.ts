export function fragmentId(hash:string):string|null {
 if(!hash.startsWith("#")||hash.length<2)return null;
 try{return decodeURIComponent(hash.slice(1));}catch{return null;}
}

/** Cached routes can contain duplicate IDs; only the visible target owns navigation. */
export function scrollToFragment(container:HTMLElement,hash:string):boolean {
 const id=fragmentId(hash);if(!id)return false;
 const target=id===container.id?container:Array.from(container.querySelectorAll<HTMLElement>("[id]")).find(node=>node.id===id&&node.getClientRects().length>0);
 if(!target||target.getClientRects().length===0)return false;
 const top=target===container?0:container.scrollTop+target.getBoundingClientRect().top-container.getBoundingClientRect().top-container.clientTop;
 container.scrollTop=Math.max(0,top);return true;
}

export interface FragmentScrollEnvironment {
 location:()=>{pathname:string;hash:string};
 frame:(callback:()=>void)=>()=>void;
 observe:(container:HTMLElement,callback:()=>void)=>()=>void;
 expire:(callback:()=>void)=>()=>void;
}
function browserEnvironment():FragmentScrollEnvironment {
 return {
  location:()=>window.location,
  frame:callback=>{const id=requestAnimationFrame(callback);return()=>cancelAnimationFrame(id);},
  observe:(container,callback)=>{const observer=new MutationObserver(callback);observer.observe(container,{childList:true,subtree:true,attributes:true,attributeFilter:["style","hidden","id"]});return()=>observer.disconnect();},
  expire:callback=>{const id=setTimeout(callback,10000);return()=>clearTimeout(id);},
 };
}

/** Wait for a streamed route or boot screen to reveal its fragment, then detach. */
export function waitForFragment(container:HTMLElement,pathname:string,hash:string,environment:FragmentScrollEnvironment=browserEnvironment()):()=>void {
 if(!fragmentId(hash))return()=>{};
 let stopped=false,scheduled=false,cancelFrame=()=>{},stopObserving=()=>{},cancelExpiry=()=>{};
 const stop=()=>{if(stopped)return;stopped=true;cancelFrame();stopObserving();cancelExpiry();};
 const schedule=()=>{if(stopped||scheduled)return;scheduled=true;cancelFrame=environment.frame(()=>{scheduled=false;const location=environment.location();if(location.pathname!==pathname||location.hash!==hash){stop();return;}if(scrollToFragment(container,hash))stop();});};
 stopObserving=environment.observe(container,schedule);cancelExpiry=environment.expire(stop);schedule();return stop;
}
