"use client";
import { BloomShelf } from "../bloom/BloomShelf";
import { BloomPromotion } from "../bloom/BloomPromotion";
import { PersonalizedFeed } from "./PersonalizedFeed";
import { MixShelf } from "./MusicMixShelf";

export function Home(){return <><BloomPromotion/><PersonalizedFeed surface="home"><BloomShelf/><MixShelf/></PersonalizedFeed></>;}

export function Discover(){return <PersonalizedFeed surface="discover"><MixShelf/></PersonalizedFeed>;}
