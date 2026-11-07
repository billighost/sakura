import type {BloomWorldDefinition,BloomWorldId} from "./types";
export const BLOOM_WORLDS:readonly BloomWorldDefinition[]=[
 {id:"sakura",name:"Sakura Afterglow",subtitle:"An orchard that remembers",description:"Ink branches, curling vines and a canopy growing from your music.",colours:["#eee4d2","#342f38","#c98594"]},
 {id:"jungle",name:"Rainforest Reverie",subtitle:"Follow the painted river",description:"A deep jungle, living water and a river opening into dawn.",colours:["#163b39","#eee8ce","#91b998"]},
 {id:"disco",name:"Velvet Disco",subtitle:"The room your music built",description:"Velvet curtains, champagne light and your own headline show.",colours:["#211527","#f8e7c8","#e794ac"]},
 {id:"japan",name:"The Lantern Book",subtitle:"A little book comes alive",description:"An illustrated lantern procession through an original Japanese storybook.",colours:["#eadebf","#2b3c51","#bf593d"]},
 {id:"china",name:"River of Ink",subtitle:"A landscape in every listen",description:"An unfolding Chinese landscape of mountains, mist and brushwork.",colours:["#e9e2cd","#303d37","#719487"]},
 {id:"korea",name:"Painted Courtyard",subtitle:"A collection to keep",description:"A Korean painted screen filling with your songs and familiar voices.",colours:["#e8d9b8","#2f314c","#b58456"]},
 {id:"india",name:"Monsoon Miniature",subtitle:"A garden painted from music",description:"A Pahari-inspired garden folio, jewel pigments and pearlescent morning.",colours:["#eee2c6","#263d51","#bc776b"]},
 {id:"ocean",name:"Tidal Dream",subtitle:"The tide brings your music back",description:"Moonlit water, luminous currents and a painted sunrise shoreline.",colours:["#162b43","#e8e7da","#8bc4c4"]},
 {id:"cosmos",name:"Paper Cosmos",subtitle:"A small observatory opens",description:"A handcrafted paper theatre unfolding into your own celestial collection.",colours:["#20334b","#efe6cd","#d3af6d"]},
 {id:"glass",name:"Prismatic Garden",subtitle:"Your music, held in light",description:"Botanical stained glass assembling into a luminous completed window.",colours:["#e5dfcf","#26373a","#af7c93"]},
];
export function isBloomWorld(value:unknown):value is BloomWorldId{return typeof value==="string"&&BLOOM_WORLDS.some(world=>world.id===value);}
export function bloomWorld(value:string):BloomWorldDefinition{const legacy:Record<string,BloomWorldId>={herbarium:"sakura",nocturne:"cosmos",risograph:"glass"};return BLOOM_WORLDS.find(world=>world.id===(legacy[value]||value))||BLOOM_WORLDS[0];}
