import test from "node:test";
import assert from "node:assert/strict";
import {
  AME_PROTOCOL_VERSION,
  assertValidAmeEvent,
  createAmeEvent,
  validateAmeEvent
} from "../src/index.js";

const validUserTurn = () => ({
  protocolVersion: AME_PROTOCOL_VERSION,
  eventId: "evt_001",
  sessionId: "ses_001",
  turnId: "turn_001",
  sequence: 1,
  timestamp: "2026-10-31T12:00:00.000Z",
  type: "user.turn",
  payload: { text: "Hello AME", source: "typed", locale: "en-IN" }
});

test("accepts a valid user turn", () => {
  assert.deepEqual(validateAmeEvent(validUserTurn()), { valid: true, errors: [] });
});

test("creates an event with the current protocol version", () => {
  const event = createAmeEvent({
    eventId: "evt_002",
    sessionId: "ses_001",
    sequence: 2,
    type: "assistant.delta",
    payload: { text: "Hello" }
  });
  assert.equal(event.protocolVersion, "0.1");
  assert.equal(event.turnId, null);
});

test("rejects unsupported protocol versions and event types", () => {
  const event = { ...validUserTurn(), protocolVersion: "9.9", type: "device.shell" };
  const result = validateAmeEvent(event);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("protocolVersion")));
  assert.ok(result.errors.some((e) => e.includes("type is unsupported")));
});

test("rejects capability execution without a scoped grant", () => {
  const event = {
    ...validUserTurn(),
    type: "capability.execute",
    payload: {
      executionId: "exec_001",
      capabilityId: "message.send",
      input: { recipientId: "contact_1", body: "Hi" },
      expiresAt: "2026-10-31T12:01:00.000Z"
    }
  };
  const result = validateAmeEvent(event);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("grantId")));
});

test("keeps effect and verification as separate result dimensions", () => {
  const event = {
    ...validUserTurn(),
    type: "capability.result",
    payload: {
      executionId: "exec_002",
      state: "completed",
      effect: "executed",
      verification: "unverified"
    }
  };
  assert.doesNotThrow(() => assertValidAmeEvent(event));
});

test("does not accept a successful claim with an unknown state", () => {
  const event = {
    ...validUserTurn(),
    type: "capability.result",
    payload: {
      executionId: "exec_003",
      state: "success",
      effect: "executed",
      verification: "verified"
    }
  };
  assert.equal(validateAmeEvent(event).valid, false);
});

test("rejects array payloads", () => {
  assert.equal(validateAmeEvent({ ...validUserTurn(), payload: [] }).valid, false);
});

test("requires a one-use approval binding for actions marked high-impact", () => {
  const base = {
    ...validUserTurn(),
    type: "capability.execute",
    payload: {
      executionId: "exec_004",
      capabilityId: "message.send",
      input: { recipientId: "contact_1", body: "Hi" },
      grantId: "grant_001",
      expiresAt: "2026-10-31T12:01:00.000Z",
      requiresApproval: true,
      requestDigest: "sha256:request-digest"
    }
  };
  assert.equal(validateAmeEvent(base).valid, false);
  assert.equal(validateAmeEvent({
    ...base,
    payload: { ...base.payload, approvalId: "approval_001" }
  }).valid, true);
});

test("requires timezone-qualified ISO timestamps", () => {
  assert.equal(validateAmeEvent({
    ...validUserTurn(),
    timestamp: "10/31/2026 12:00 PM"
  }).valid, false);
});

test("accepts a device-bound conversation resume identifier on session.open", () => {
  const event = createAmeEvent({
    eventId: "evt_resume_001",
    sessionId: "ses_001",
    sequence: 0,
    type: "session.open",
    payload: {
      deviceId: "device_001",
      appVersion: "1.0.0",
      deviceCapabilities: [],
      conversationId: "conversation_001"
    }
  });
  assert.equal(validateAmeEvent(event).valid, true);
});

test("rejects an invalid conversation resume identifier", () => {
  const event = {
    ...validUserTurn(),
    type: "session.open",
    payload: {
      deviceId: "device_001",
      appVersion: "1.0.0",
      deviceCapabilities: [],
      conversationId: 42
    }
  };
  assert.equal(validateAmeEvent(event).valid, false);
});
