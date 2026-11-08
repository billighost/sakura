import assert from "node:assert/strict";
import {test} from "node:test";
import {preferencesPatch,DEFAULT_SETTINGS,ProductError} from "../src/rebuild/data/validation";
import {settingsFields,unacknowledgedPreferences} from "../src/rebuild/app/preferences";
import {FEED_DEFAULTS,FEED_NUMERIC_FIELDS,FEED_BOOLEAN_FIELDS} from "../src/rebuild/app/feedPreferences";

test("feed preferences survive server validation and account offline persistence",()=>{
  const patch={discovery:0,artistVariety:1,repeatTolerance:.3,newReleaseBias:.7,deepCutBias:.9,timeAware:false,learnFromListening:false};
  assert.deepEqual(preferencesPatch(patch),patch);
  assert.deepEqual(settingsFields({...patch,revision:23,accountId:"another listener"}),patch);
  for(const [field,value] of Object.entries(FEED_DEFAULTS))assert.equal(DEFAULT_SETTINGS[field as keyof typeof DEFAULT_SETTINGS],value);
  assert.deepEqual(unacknowledgedPreferences(patch,{artistVariety:1,timeAware:false}),{discovery:0,repeatTolerance:.3,newReleaseBias:.7,deepCutBias:.9,learnFromListening:false});
});

test("malformed controls cannot enter stored feed preferences",()=>{
  for(const field of FEED_NUMERIC_FIELDS)for(const value of [-1,1.01,NaN,Infinity,"0.5",null,{},[]]){
    assert.throws(()=>preferencesPatch({[field]:value}),ProductError);
    assert.deepEqual(settingsFields({[field]:value}),{});
  }
  for(const field of FEED_BOOLEAN_FIELDS)for(const value of [0,1,"false",null,{},[]]){
    assert.throws(()=>preferencesPatch({[field]:value}),ProductError);
    assert.deepEqual(settingsFields({[field]:value}),{});
  }
});
