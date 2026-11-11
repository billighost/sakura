import assert from "node:assert/strict";
import {test} from "node:test";
import {validPreferenceReceipt} from "../src/rebuild/app/preferenceReceipt";

test("only matching preference values and safe revisions acknowledge a save",()=>{
  const sent={theme:"dark" as const,volume:.3};
  const accepted={theme:"dark",volume:.3,revision:9,fieldRevisions:{theme:9,volume:9}};
  assert.equal(validPreferenceReceipt(accepted,sent,8),true);
  assert.equal(validPreferenceReceipt({settings:accepted},sent,8),true);
  for(const response of [{},null,[],{...accepted,theme:"light"},{...accepted,volume:undefined},{...accepted,revision:"9"},{...accepted,revision:7},{...accepted,fieldRevisions:{}},{...accepted,fieldRevisions:{theme:10,volume:9}}])
    assert.equal(validPreferenceReceipt(response,sent,8),false,JSON.stringify(response));
});
