"use client";
import { useEffect, useMemo, useState } from "react";
import { useMusicActions, useMusicView } from "../app/musicView";
import { userMessage } from "../app/errors";
import { lyricReadingEnabled, lyricReadingPatch } from "../app/readingPreferences";
import { READING_LABELS, readingEngine, type ReadingLanguage } from "../lyrics/language";
import { lyricInputKey, type useLyrics } from "./useLyrics";

/** The account preference outlives a lyric view; fetching never changes that choice. */
export function useJapaneseReading(lyrics: ReturnType<typeof useLyrics>) {
  const music = { ...useMusicView(), ...useMusicActions() };
  const language=lyrics.data?.readingLanguage===undefined&&lyrics.data?.hasJapanese?"ja":lyrics.data?.readingLanguage;
  const enabled = lyricReadingEnabled(music.settings);
  const [retryVersion, setRetryVersion] = useState(0);
  const [state, setState] = useState<{ key: string; busy: boolean; error: string | null }>({ key: "", busy: false, error: null });
  const key = useMemo(() => music.track && language && lyrics.data
    ? JSON.stringify([music.account?.id, language, lyricInputKey(music.track), lyrics.data.lines.map(line => [line.start, line.end, line.text])]) : "", [music.account?.id, music.track, language, lyrics.data]);
  const needsReading = useMemo(() => Boolean(lyrics.data?.lines.some(line => line.text.trim() && (line.romanized === undefined || line.readingEngine !== (language?readingEngine(language):"")))), [lyrics.data, language]);
  const getReadings = lyrics.getJapaneseReadings;

  useEffect(() => {
    if (!enabled || !key || !needsReading) return;
    let cancelled = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    const prepare = async () => {
      if (cancelled) return;
      setState({ key, busy: true, error: null });
      try {
        await getReadings(language!, controller.signal, music.account?.id);
        if (!cancelled) setState({ key, busy: false, error: null });
      } catch (error) {
        if (cancelled) return;
        setState({ key, busy: false, error: userMessage(error, "lyrics") });
        // A brief outage should not require re-enabling a saved preference.
        if (attempt++ < 2) timer = setTimeout(() => void prepare(), attempt * 5000);
      }
    };
    void prepare();
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, [enabled, key, needsReading, getReadings, retryVersion, language, music.account?.id]);

  useEffect(() => {
    if (!enabled) return;
    const retry = () => setRetryVersion(version => version + 1);
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [enabled]);

  function toggle() {
    const next = !enabled;
    const patch = lyricReadingPatch(next);
    void music.updateSettings(patch).catch(error => music.reportError(error, "save", () => {
      void music.updateSettings(patch).catch(failure => music.reportError(failure, "save"));
    }));
  }
  return {
    enabled, language, label:language?READING_LABELS[language]:"Transliteration",
    setLanguage:(value:ReadingLanguage)=>{void lyrics.setReadingLanguage(value);},
    busy: enabled && needsReading && state.key === key && state.busy,
    error: enabled && needsReading && state.key === key ? state.error : null,
    toggle,
    retry: () => setRetryVersion(version => version + 1),
  };
}
