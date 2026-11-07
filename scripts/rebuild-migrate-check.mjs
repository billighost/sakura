import 'dotenv/config';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { schemaFiles } from './rebuild-migrate.mjs';

// Rehearse a completely fresh install in temporary schemas inside a transaction.
// Neither the real identity table nor the production catalogue is changed.
const nonce=randomUUID().replaceAll('-','');
const identitySchema='sakura_check_auth_'+nonce,productSchema='sakura_check_data_'+nonce;
const pool=new pg.Pool({connectionString:process.env.SAKURA_REBUILD_DATABASE_URL||process.env.DATABASE_URL,
  max:1,connectionTimeoutMillis:10000,statement_timeout:20000});
let client;
try {
  client=await pool.connect();await client.query('BEGIN');
  await client.query(`CREATE SCHEMA "${identitySchema}"`);
  for(const file of schemaFiles){
    const sql=(await readFile(new URL(file,import.meta.url),'utf8')).replace(/^BEGIN;\s*$/gm,'').replace(/^COMMIT;\s*$/gm,'')
      .replaceAll('sakura_v2',productSchema).replaceAll('public."User"',`"${identitySchema}"."User"`);
    await client.query(sql);
  }
  const user=(await client.query(`INSERT INTO "${identitySchema}"."User"(username,email,"passwordHash")
    VALUES('fresh_test','fresh_test@example.invalid','not-a-password') RETURNING id,"createdAt"`)).rows[0];
  if(!user.id||!user.createdAt)throw new Error('missing-identity-defaults');
  const tables=(await client.query(`SELECT COUNT(*)::integer AS n FROM information_schema.tables WHERE table_schema=ANY($1::text[])`,[[identitySchema,productSchema]])).rows[0].n;
  const old=(await client.query(`SELECT COUNT(*)::integer AS n FROM information_schema.tables WHERE table_schema=$1 AND table_name='Track'`,[identitySchema])).rows[0].n;
  if(tables<20||old!==0)throw new Error('fresh-install-reconciliation');
  await client.query('ROLLBACK');
  console.log(JSON.stringify({status:'passed',mode:'transaction-rolled-back',tables,authDefaults:true,legacyProductTablesRequired:false}));
}catch(error){
  await client?.query('ROLLBACK').catch(()=>{});console.error(JSON.stringify({status:'failed',code:error.code||error.message}));process.exitCode=1;
}finally{client?.release();await pool.end();}
