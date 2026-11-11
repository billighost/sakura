"use client";
import { SelectPopover } from "../app/SelectPopover";
import { READING_LANGUAGES, READING_LABELS, type ReadingLanguage } from "../lyrics/language";
import type { useJapaneseReading } from "./useJapaneseReading";

export function ReadingLanguageChoice({guide}:{guide:ReturnType<typeof useJapaneseReading>}) {
  if(!guide.language)return null;
  return <SelectPopover<ReadingLanguage> label="Reading language" value={guide.language} onChange={guide.setLanguage} options={READING_LANGUAGES.map(value=>({value,label:READING_LABELS[value]}))}/>;
}
