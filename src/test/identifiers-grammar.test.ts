import assert from "node:assert/strict";
import test from "node:test";
import {
  initiativeIdOf,
  isWaveId,
  isWorkId,
  parseWaveId,
  parseWorkId,
  waveIdOf,
  waveNumberOf,
  workPositionOf,
} from "../core/identifiers.js";

test("isWaveId accepts WAVE-<i>.<w> and rejects invalid forms", () => {
  assert.equal(isWaveId("WAVE-1.1"), true);
  assert.equal(isWaveId("WAVE-10.3"), true);
  assert.equal(isWaveId("WAVE-99.99"), true);
  // Leading zeros rejected
  assert.equal(isWaveId("WAVE-01.1"), false);
  assert.equal(isWaveId("WAVE-1.01"), false);
  // Invalid formats
  assert.equal(isWaveId("INIT-1"), false);
  assert.equal(isWaveId("WORK-1.1.1"), false);
  assert.equal(isWaveId("WAVE-1"), false);
  assert.equal(isWaveId("WAVE-1.1.1"), false);
});

test("parseWaveId parses valid and rejects invalid", () => {
  assert.equal(parseWaveId("WAVE-1.1"), "WAVE-1.1");
  assert.throws(() => parseWaveId("WAVE-01.1"));
  assert.throws(() => parseWaveId("INIT-1"));
});

test("isWorkId accepts only the canonical three-component form", () => {
  assert.equal(isWorkId("WORK-1.1.1"), true);
  assert.equal(isWorkId("WORK-10.3.5"), true);
  assert.equal(isWorkId("WORK-10.1.99"), true);
  // Leading zeros rejected in every component
  assert.equal(isWorkId("WORK-01.1.1"), false);
  assert.equal(isWorkId("WORK-1.01.1"), false);
  assert.equal(isWorkId("WORK-1.1.01"), false);
  assert.equal(isWorkId("WORK-1.1"), false);
  assert.equal(isWorkId("WAVE-1.1"), false);
  assert.equal(isWorkId("INIT-1"), false);
});

test("parseWorkId parses a canonical id and rejects anything else", () => {
  assert.equal(parseWorkId("WORK-1.1.1"), "WORK-1.1.1");
  assert.throws(() => parseWorkId("WORK-1.1"), /must match WORK-<initiative>\.<wave>\.<position>/);
});

test("waveIdOf derives the wave from a Work id", () => {
  assert.equal(waveIdOf("WORK-1.2.3"), "WAVE-1.2");
  assert.equal(waveIdOf("WORK-10.5.1"), "WAVE-10.5");
  assert.throws(() => waveIdOf("WORK-1.1"));
  assert.throws(() => waveIdOf("WAVE-1.1"));
});

test("initiativeIdOf accepts Wave and Work ids", () => {
  assert.equal(initiativeIdOf("WAVE-1.1"), "INIT-1");
  assert.equal(initiativeIdOf("WORK-10.5.1"), "INIT-10");
  assert.throws(() => initiativeIdOf("INIT-1"));
});

test("waveNumberOf extracts wave number", () => {
  assert.equal(waveNumberOf("WAVE-1.2"), 2);
  assert.equal(waveNumberOf("WAVE-10.3"), 3);
  assert.throws(() => waveNumberOf("WORK-1.1.1"));
  assert.throws(() => waveNumberOf("WAVE-1.01"));
});

test("workPositionOf extracts the position", () => {
  assert.equal(workPositionOf("WORK-1.1.2"), 2);
  assert.equal(workPositionOf("WORK-10.5.99"), 99);
  assert.throws(() => workPositionOf("WAVE-1.2"));
  assert.throws(() => workPositionOf("WAVE-1.1"));
});
