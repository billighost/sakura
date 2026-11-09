import assert from "node:assert/strict";
import test from "node:test";
import { playlistArtworkSources } from "../src/rebuild/app/playlistArtwork";

test("playlist artwork keeps a stable custom cover and distinct song covers",()=>{
 const custom="https://images.example/custom.jpg#crop";
 assert.deepEqual(playlistArtworkSources(custom,[custom,"https://images.example/a.jpg","https://images.example/a.jpg","https://images.example/b.jpg"]),[
  "https://images.example/custom.jpg","https://images.example/a.jpg","https://images.example/b.jpg",
 ]);
});

test("playlist artwork ignores unsafe and malformed sources and caps the collage",()=>{
 assert.deepEqual(playlistArtworkSources(null,["javascript:alert(1)","data:image/png;base64,a","not a url"]),[]);
 assert.deepEqual(playlistArtworkSources(null,[1,2,3,4,5].map(value=>`https://images.example/${value}.jpg`)),[
  "https://images.example/1.jpg","https://images.example/2.jpg","https://images.example/3.jpg","https://images.example/4.jpg",
 ]);
});
