"use client";
import { useEffect, useState } from "react";
import { useMusic } from "../app/MusicContext";
import { userMessage } from "../app/errors";
import { READING_LABELS, readingEngine, type ReadingLanguage } from "../lyrics/language";
import { lyricInputKey, type useLyrics } from "./useLyrics";

/** The account preference outlives a lyric view; fetching never changes that choice. */
export function useJapaneseReading(lyrics: ReturnType<typeof useLyrics>) {
  const music = useMusic();
  const language=lyrics.data?.readingLanguage||(lyrics.data?.hasJapanese?"ja":null);
  const enabled = (language==="ja"?music.settings.japaneseReading:music.settings.lyricReading) === true;
  const [retryVersion, setRetryVersion] = useState(0);
  const [state, setState] = useState<{ key: string; busy: boolean; error: string | null }>({ key: "", busy: false, error: null });
  const key = music.track && language && lyrics.data
    ? JSON.stringify([music.account?.id, language, lyricInputKey(music.track), lyrics.data.lines.map(line => [line.start, line.end, line.text])]) : "";
  const needsReading = Boolean(lyrics.data?.lines.some(line => line.text.trim() && (line.romanized === undefined || line.readingEngine !== (language?readingEngine(language):""))));
  const getReadings = lyrics.getJapaneseReadings;

  useEffect(() => {
    if (!enabled || !key || !needsReading) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    const prepare = async () => {
      if (cancelled) return;
      setState({ key, busy: true, error: null });
      try {
        await getReadings(language!);
        if (!cancelled) setState({ key, busy: false, error: null });
      } catch (error) {
        if (cancelled) return;
        setState({ key, busy: false, error: userMessage(error, "lyrics") });
        // A brief outage should not require re-enabling a saved preference.
        if (attempt++ < 2) timer = setTimeout(() => void prepare(), attempt * 5000);
      }
    };
    void prepare();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [enabled, key, needsReading, getReadings, retryVersion, language]);

  useEffect(() => {
    if (!enabled) return;
    const retry = () => setRetryVersion(version => version + 1);
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [enabled]);

  function toggle() {
    const next = !enabled;
    void music.updateSettings(language==="ja"?{japaneseReading:next}:{lyricReading:next}).catch(error => music.reportError(error, "save", () => {
      void music.updateSettings(language==="ja"?{japaneseReading:next}:{lyricReading:next}).catch(failure => music.reportError(failure, "save"));
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
