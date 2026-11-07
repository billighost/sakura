"use client";
import { useEffect } from "react";
export function Pwa() {
 useEffect(() => {
  if (!("serviceWorker" in navigator)) return;
  if(process.env.NODE_ENV!=="production"){void navigator.serviceWorker.getRegistrations().then(list=>Promise.all(list.map(item=>item.unregister())));return;}
  void navigator.serviceWorker.register("/sw.js").catch(() => {});
 }, []);
 return null;
}
