import assert from "node:assert/strict";
import test from "node:test";
import { romanizeScriptSpan } from "../src/rebuild/lyrics/scriptReading";

test("Ukrainian vowel mappings differ from Russian and respect a word's position", () => {
  assert.equal(romanizeScriptSpan("Червону руту не шукай вечорами", "uk").romanized, "Chervonu rutu ne shukai vechoramy");
  assert.equal(romanizeScriptSpan("Єва їде в Київ", "uk").romanized, "Yeva yide v Kyiv");
  assert.equal(romanizeScriptSpan("п’ять згода", "uk").romanized, "p’iat zghoda");
  assert.equal(romanizeScriptSpan("Группа крови", "ru").romanized, "Gruppa krovi");
});

test("Greek vowel digraphs and diaeresis remain distinct", () => {
  assert.equal(romanizeScriptSpan("Δώδεκα κι ούτε ένα τηλεφώνημα", "el").romanized, "Dodeka ki oute ena tilefonima");
  assert.equal(romanizeScriptSpan("αυγή ευχή αϊ αϋ", "el").romanized, "avgi efchi aï aÿ");
  assert.equal(romanizeScriptSpan("ΟΥΤΕ", "el").romanized, "OUTE");
});

test("Hindi retains inherent vowels, matras and nasals in actual song words", () => {
  assert.equal(romanizeScriptSpan("हम तेरे बिन अब रह नहीं सकते", "hi").romanized, "ham tere bin ab rah nahī̃ sakte");
  assert.equal(romanizeScriptSpan("तुम ही हो", "hi").romanized, "tum hī ho");
  assert.equal(romanizeScriptSpan("एक पल मेरा दिल", "hi").romanized, "ek pal merā dil");
  assert.equal(romanizeScriptSpan("कभी रात ज्ञान ज़िंदगी फ़ासला", "hi").romanized, "kabhī rāt gyān zindagī fāsalā");
  assert.equal(romanizeScriptSpan("अपना सुनना माला", "hi").romanized, "apnā sunnā mālā");
});

test("Hindi vowel nasalization, homorganic consonants and conjunct controls are distinct", () => {
  assert.equal(romanizeScriptSpan("चलता हूँ दुआओं में याद रखना", "hi").romanized, "chaltā hū̃ duāõ mẽ yād rakhnā".normalize("NFC"));
  assert.equal(romanizeScriptSpan("साँस काँटा अंग हिंदी चंचल कंठ संबंध", "hi").romanized, "sā̃s kā̃ṭā aṅg hindī chañchal kaṇṭh sambandh");
  assert.equal(romanizeScriptSpan("ज्ञान ज्‍ञान ज्‌ञान ज़िंदगी ज़िंदगी", "hi").romanized, "gyān gyān gyān zindagī zindagī");
});

test("Hindi noun endings do not masquerade as verb inflections or erase explicit vowels", () => {
  assert.equal(romanizeScriptSpan("जननी सरस्वती भगवती अवनी", "hi").romanized, "jananī sarasvatī bhagavatī avanī");
  assert.equal(romanizeScriptSpan("कविता पुराना बहाना मकान", "hi").romanized, "kavitā purānā bahānā makān");
  assert.equal(romanizeScriptSpan("साधना रचना भावना", "hi").romanized, "sādhanā rachanā bhāvanā");
  assert.equal(romanizeScriptSpan("रखना मिलते रहते करती हमने", "hi").romanized, "rakhnā milte rahte kartī hamne");
});

test("script readers keep punctuation, original Latin words and unknown letters", () => {
  assert.equal(romanizeScriptSpan("Hello 🌸, हम!", "hi").romanized, "Hello 🌸, ham!");
  assert.ok(romanizeScriptSpan("تملي معاك", "ar").romanized.includes(" "));
  assert.equal(romanizeScriptSpan("Ѯ", "ru").romanized, "Ѯ");
  assert.equal(romanizeScriptSpan("ت", "ar").romanized, "t");
});

test("Arabic reads explicit vowels and gemination without inventing omitted vowels", () => {
  assert.equal(romanizeScriptSpan("حَبِيبِي يَا نُور الْعَيْن", "ar").romanized, "ḥabībī yā nūr alʿayn");
  assert.equal(romanizeScriptSpan("رَبَّ", "ar").romanized, "rabba");
  assert.equal(romanizeScriptSpan("تملي معاك", "ar").romanized, "tmly mʿāk");
});
