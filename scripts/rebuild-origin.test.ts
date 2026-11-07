import {test} from "node:test";
import assert from "node:assert/strict";
import {sameRequestOrigin} from "../src/rebuild/requestOrigin";
test("browser origin uses the public host when Next binds to all interfaces",()=>{
 assert.equal(sameRequestOrigin(new Request("http://0.0.0.0:3000/api/auth/register",{headers:{Host:"localhost:3000",Origin:"http://localhost:3000"}})),true);
 assert.equal(sameRequestOrigin(new Request("http://0.0.0.0:3000/api/auth/register",{headers:{Host:"172.20.10.3:3000",Origin:"http://172.20.10.3:3000"}})),true);
});
test("origin checks reject unrelated origins, ports, malformed authorities and schemes",()=>{
 for(const origin of ["https://attacker.invalid","http://localhost:3001","https://localhost:3000","null","http://localhost:3000/path"]){assert.equal(sameRequestOrigin(new Request("http://0.0.0.0:3000/api",{headers:{Host:"localhost:3000",Origin:origin}})),false);}
});
test("HTTPS reverse proxy preserves the external origin and no-origin clients remain valid",()=>{
 assert.equal(sameRequestOrigin(new Request("http://internal:3000/api",{headers:{Host:"music.example.com",Origin:"https://music.example.com","x-forwarded-proto":"https"}})),true);
 assert.equal(sameRequestOrigin(new Request("http://localhost:3000/api")),true);
});
