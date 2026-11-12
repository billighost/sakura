import {readFile,writeFile,access} from "node:fs/promises";
import {spawn} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";
import dotenv from "dotenv";

// Run only when connection to the linked deployment project is authorized.
// Secret values travel through stdin; CLI output is captured and never echoed.
const root=fileURLToPath(new URL("..",import.meta.url));
const cli=process.platform==="win32"&&process.env.APPDATA
 ? path.join(process.env.APPDATA,"npm/node_modules/vercel/dist/vc.js") : process.env.SAKURA_VERCEL_CLI;
function run(args,value){return new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,[cli,...args],{cwd:root,stdio:["pipe","pipe","pipe"],windowsHide:true});
 let output="",size=0;
 child.stdout.on("data",chunk=>{size+=chunk.length;if(size<4*1024*1024)output+=chunk;});
 child.stderr.on("data",()=>{});
 const timeout=setTimeout(()=>child.kill(),60000);
 child.once("error",()=>{clearTimeout(timeout);reject(new Error("Unable to start Vercel CLI"));});
 child.once("close",code=>{clearTimeout(timeout);code===0?resolve(output):reject(new Error("Vercel configuration command did not succeed"));});
 child.stdin.on("error",()=>{});child.stdin.end(value===undefined?undefined:value+"\n");
});}
try{
 if(!cli)throw new Error("Set SAKURA_VERCEL_CLI to the official installed CLI entry point");
 await access(cli);
 const project=JSON.parse(await readFile(path.join(root,".vercel/project.json"),"utf8"));
 if(project.projectName!=="sakuraplayer")throw new Error("Expected the linked sakuraplayer project");
 const env=dotenv.parse(await readFile(path.join(root,".env.local"),"utf8"));
 const url=new URL(env.UPSTASH_REDIS_REST_URL);
 if(url.protocol!=="https:"||!url.hostname.endsWith(".upstash.io")||!env.UPSTASH_REDIS_REST_TOKEN)throw new Error("Local Redis configuration is incomplete");
 const environments=["production","preview"];
 const names=["UPSTASH_REDIS_REST_URL","UPSTASH_REDIS_REST_TOKEN","SAKURA_REDIS_NAMESPACE","SAKURA_REDIS_TIMEOUT_MS"];
 for(const environment of environments){
  const values={UPSTASH_REDIS_REST_URL:env.UPSTASH_REDIS_REST_URL,UPSTASH_REDIS_REST_TOKEN:env.UPSTASH_REDIS_REST_TOKEN,
   SAKURA_REDIS_NAMESPACE:environment==="production"?"sakura:public:v1":"sakura:preview:public:v1",SAKURA_REDIS_TIMEOUT_MS:"75"};
  for(const name of names){
   await run(["env","add",name,"--environment",environment,name.startsWith("UPSTASH_")?"--sensitive":"--no-sensitive","--force","--yes","--json"],values[name]);
   console.log(JSON.stringify({configured:name,environment}));
  }
 }
 const inventory=JSON.parse(await run(["env","ls","--json"]));
 const entries=Array.isArray(inventory)?inventory:inventory.envs||inventory.environmentVariables;
 if(!Array.isArray(entries))throw new Error("Unexpected Vercel environment inventory");
 for(const environment of environments)for(const name of names){
  const entry=entries.find(row=>(row.key||row.name)===name&&(Array.isArray(row.target)?row.target.includes(environment):row.target===environment)&&!row.gitBranch);
  if(!entry)throw new Error("A required environment setting is missing");
  if(name.startsWith("UPSTASH_")&&!["sensitive","secret"].includes(entry.type))throw new Error("Redis credentials must be stored as secrets");
 }
 const filename=path.join(root,"docs/rebuild/UPSTASH-SETUP.json");
 const report=JSON.parse(await readFile(filename,"utf8"));
 Object.assign(report,{deploymentEnvironmentConfigured:true,deploymentProject:project.projectName,deploymentEnvironments:environments,
  deploymentVariables:names,productionNamespace:"sakura:public:v1",previewNamespace:"sakura:preview:public:v1",deploymentEnvironmentVerifiedAt:new Date().toISOString(),applicationDeployed:false});
 await writeFile(filename,JSON.stringify(report,null,2)+"\n");
 console.log(JSON.stringify({deploymentEnvironmentConfigured:true,project:project.projectName,environments,applicationDeployed:false}));
}catch{
 console.error("Redis environment setup did not complete; credentials and CLI output were withheld.");process.exitCode=1;
}
