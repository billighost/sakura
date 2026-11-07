"use client";
export default function GlobalError({retry}:{error:unknown;retry:()=>void}){
 return <html lang="en"><body style={{margin:0,background:"#f5f5ee",color:"#273b34",minHeight:"100vh",display:"grid",placeItems:"center",fontFamily:"Georgia,serif",padding:24}}><main style={{maxWidth:420}}><h1>A little pause in the music.</h1><p style={{lineHeight:1.7}}>Sakura could not open this time. Reconnect and try again, or return to the songs saved on this device.</p><button onClick={retry} style={{padding:"12px 22px",background:"#446b57",color:"#f9faf3",border:0,marginRight:16,minHeight:44}}>Reconnect</button><a href="/offline">Open downloads</a></main></body></html>;
}
