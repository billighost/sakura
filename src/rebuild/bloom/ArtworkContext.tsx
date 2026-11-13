"use client";
import {createContext} from "react";

/** Only sources already owned by this account's current preparation enter this
 * boundary. Original export artwork deliberately bypasses the display map. */
export const BloomArtworkContext=createContext<Readonly<Record<string,string>>>({});
