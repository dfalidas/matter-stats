import test from "node:test";
import assert from "node:assert/strict";
import { buildSessionLengthHistogram, estimateWordsFromSeconds, sessionLengthBucket } from "../lib/reading-estimates";

test("estimates once from total duration at 225 WPM",()=>{assert.equal(estimateWordsFromSeconds(80),300);assert.equal(estimateWordsFromSeconds(0),0);assert.equal(estimateWordsFromSeconds(-4),0)});
test("session ranges are non-overlapping at exact boundaries",()=>{assert.equal(sessionLengthBucket(299),"<5 min");assert.equal(sessionLengthBucket(300),"5–<15 min");assert.equal(sessionLengthBucket(900),"15–<30 min");assert.equal(sessionLengthBucket(1800),"≥30 min")});
test("histogram includes every session exactly once",()=>{assert.deepEqual(buildSessionLengthHistogram([1,299,300,899,900,1799,1800]).map(x=>x.count),[2,2,2,1])});
