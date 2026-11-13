import type { ReadingLanguage } from '../../src/rebuild/lyrics/language';

/** Short independently chosen song excerpts; these are not saved full lyrics. */
export interface ReadingSongExcerpt {
 id: string;
 language: ReadingLanguage;
 title: string;
 artist: string;
 artists: string[];
 alternateTitles?: string[];
 queryTitle?: string;
 queryArtist?: string;
 capture?: string;
 text: string;
 alternateTexts?: string[];
 expected: string;
 mode: 'pinyin' | 'pronunciation' | 'script';
 hintRequired?: boolean;
}

export const READING_SONG_EXCERPTS: readonly ReadingSongExcerpt[] = [
 {id:'tian-mi-mi',language:'zh',title:'甜蜜蜜',artist:'邓丽君',artists:['鄧麗君','Teresa Teng'],capture:'chinese',text:'甜蜜蜜你笑得甜蜜蜜',expected:'tián mì mì nǐ xiào de tián mì mì',mode:'pinyin'},
 {id:'moon-heart',language:'zh',title:'月亮代表我的心',artist:'鄧麗君',artists:['邓丽君','Teresa Teng'],queryArtist:'邓丽君',text:'你問我愛你有多深',alternateTexts:['你问我爱你有多深'],expected:'nǐ wèn wǒ ài nǐ yǒu duō shēn',mode:'pinyin'},
 {id:'world-this-big',language:'zh',title:'世界這麼大還是遇見你',artist:'程響',artists:['程响','Cheng Xiang'],alternateTitles:['世界这么大还是遇见你'],queryTitle:'世界这么大还是遇见你',queryArtist:'程响',text:'世界這麼大還是遇見你',alternateTexts:['世界这么大还是遇见你'],expected:'shì jiè zhè me dà hái shì yù jiàn nǐ',mode:'pinyin'},
 {id:'yoru-ni-kakeru',language:'ja',title:'夜に駆ける',artist:'YOASOBI',artists:['YOASOBI'],capture:'yoasobi',text:'沈むように溶けてゆくように',expected:'shizumu you ni tokete yuku you ni',mode:'pronunciation'},
 {id:'lemon',language:'ja',title:'Lemon',artist:'米津玄師',artists:['Kenshi Yonezu'],queryArtist:'Kenshi Yonezu',text:'夢ならばどれほどよかったでしょう',expected:'yume naraba dorehodo yokatta deshou',mode:'pronunciation'},
 {id:'spring-day',language:'ko',title:'Spring Day',artist:'BTS',artists:['BTS','방탄소년단'],alternateTitles:['봄날'],capture:'korean',text:'보고 싶다',expected:'bogo sipda',mode:'pronunciation'},
 {id:'gruppa-krovi',language:'ru',title:'Группа крови',artist:'Кино',artists:['Kino'],alternateTitles:['Gruppa Krovi'],text:'Группа крови на рукаве',expected:'gruppa krovi na rukave',mode:'pronunciation'},
 {id:'chervona-ruta',language:'uk',title:'Червона рута',artist:'Софія Ротару',artists:['София Ротару','Sofia Rotaru','Sofiya Rotaru'],alternateTitles:['Chervona Ruta'],text:'Червону руту не шукай вечорами',expected:'chervonu rutu ne shukai vechoramy',mode:'pronunciation',hintRequired:true},
 {id:'dodeka',language:'el',title:'Δώδεκα',artist:'Άννα Βίσση',artists:['Anna Vissi','Αννα Βισση'],alternateTitles:['Dodeka'],queryTitle:'Dodeka',queryArtist:'Anna Vissi',text:'Δώδεκα κι ούτε ένα τηλεφώνημα',expected:'dodeka ki oute ena tilefonima',mode:'pronunciation'},
 {id:'tum-hi-ho',language:'hi',title:'Tum Hi Ho',artist:'Arijit Singh',artists:['Arijit Singh'],alternateTitles:['तुम ही हो'],text:'हम तेरे बिन अब रह नहीं सकते',expected:'ham tere bin ab rah nahin sakte',mode:'pronunciation'},
 {id:'tamally-maak',language:'ar',title:'Tamally Maak',artist:'Amr Diab',artists:['عمرو دياب','Amr Diab'],alternateTitles:['تملي معاك'],text:'تملي معاك',expected:'tmly mʿāk',mode:'script'},
];

/** Word segmentation can differ between dictionaries without changing sounds. */
export function pronunciationLetters(text: string) {
 return text.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
}
