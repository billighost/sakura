"use client";
import type { ComponentProps } from "react";
import s from "./player.module.css";
import {
  Artwork as CommonArtwork,
  IconButton as CommonIconButton,
  PlayerButton as CommonPlayerButton,
  PlayerDialog as CommonPlayerDialog,
} from "./CommonPrimitives";

export { PlayerIcon, formatPlaybackTime, type PlayerIconName } from "./CommonPrimitives";

// Listening rooms retain their authored selectors; ordinary dialogs share the
// smaller primitive stylesheet without pulling in player, lyric or share CSS.
export function Artwork(props: ComponentProps<typeof CommonArtwork>) {
  return <CommonArtwork {...props} styles={s}/>;
}
export function IconButton(props: ComponentProps<typeof CommonIconButton>) {
  return <CommonIconButton {...props} styles={s}/>;
}
export function PlayerButton(props: ComponentProps<typeof CommonPlayerButton>) {
  return <CommonPlayerButton {...props} styles={s}/>;
}
export function PlayerDialog(props: ComponentProps<typeof CommonPlayerDialog>) {
  return <CommonPlayerDialog {...props} styles={s}/>;
}
