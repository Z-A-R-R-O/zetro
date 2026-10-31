/**
 * AME <-> ZETRO protocol primitives.
 * Validates event envelopes only. Authentication, authorization,
 * capability-specific input validation and execution remain server/device duties.
 */
export const AME_PROTOCOL_VERSION = "0.1";

export const AME_EVENT_TYPES = Object.freeze([
  "session.open", "session.accepted", "session.close",
  "transcript.partial", "user.turn", "assistant.delta", "assistant.complete",
  "capability.proposed", "approval.required", "approval.decided",
  "capability.execute", "capability.result", "session.error"
]);

const eventTypeSet = new Set(AME_EVENT_TYPES);
const riskLevels = new Set(["low", "medium", "high"]);
const decisions = new Set(["approved", "denied"]);
const actionStates = new Set(["completed", "failed", "cancelled", "unknown"]);
const effectStates = new Set(["not_attempted", "executed", "failed", "unknown"]);
const verificationStates = new Set(["not_requested", "verified", "unverified", "unknown"]);

const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const isNonEmptyString = (value, max = 512) =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;
const isIsoDate = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  !Number.isNaN(Date.parse(value));
const isStringArray = (value, maxItems = 64) =>
  Array.isArray(value) && value.length <= maxItems &&
  value.every((item) => isNonEmptyString(item, 128));
const isCapabilityId = (value) =>
  typeof value === "string" && /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_]*)+$/.test(value);

function validatePayload(type, payload, errors) {
  const need = (condition, field, expected) => {
    if (!condition) errors.push("payload." + field + " must be " + expected);
  };
  const str = (field, max) => need(isNonEmptyString(payload[field], max), field, "a non-empty string");
  const capability = () => need(isCapabilityId(payload.capabilityId), "capabilityId", "a namespaced capability ID");
  const object = (field) => need(isRecord(payload[field]), field, "an object");
  const date = (field) => need(isIsoDate(payload[field]), field, "an ISO-8601 date/time");

  switch (type) {
    case "session.open":
      str("deviceId", 160);
      str("appVersion", 80);
      need(isStringArray(payload.deviceCapabilities), "deviceCapabilities", "an array of strings");
      break;
    case "session.accepted":
      str("conversationId", 160);
      date("serverTime");
      need(payload.capabilities === undefined || isStringArray(payload.capabilities), "capabilities", "an optional array of strings");
      break;
    case "session.close":
      str("reason", 160);
      break;
    case "transcript.partial":
      need(typeof payload.text === "string" && payload.text.length <= 8000, "text", "a string of at most 8000 characters");
      str("locale", 40);
      break;
    case "user.turn":
      str("text", 8000);
      need(payload.source === "typed" || payload.source === "transcribed", "source", "typed or transcribed");
      str("locale", 40);
      break;
    case "assistant.delta":
      need(typeof payload.text === "string" && payload.text.length <= 8000, "text", "a string of at most 8000 characters");
      break;
    case "assistant.complete":
      str("text", 32000);
      break;
    case "capability.proposed":
      str("executionId", 160);
      capability();
      str("summary", 1000);
      need(riskLevels.has(payload.risk), "risk", "low, medium, or high");
      break;
    case "approval.required":
      str("approvalId", 160);
      str("executionId", 160);
      capability();
      str("summary", 1000);
      date("expiresAt");
      str("requestDigest", 256);
      break;
    case "approval.decided":
      str("approvalId", 160);
      str("executionId", 160);
      need(decisions.has(payload.decision), "decision", "approved or denied");
      str("requestDigest", 256);
      break;
    case "capability.execute":
      str("executionId", 160);
      capability();
      object("input");
      str("grantId", 160);
      date("expiresAt");
      need(typeof payload.requiresApproval === "boolean", "requiresApproval", "a boolean");
      if (payload.requiresApproval) {
        str("approvalId", 160);
        str("requestDigest", 256);
      } else if (payload.approvalId !== undefined) {
        str("approvalId", 160);
      }
      break;
    case "capability.result":
      str("executionId", 160);
      need(actionStates.has(payload.state), "state", "completed, failed, cancelled, or unknown");
      need(effectStates.has(payload.effect), "effect", "not_attempted, executed, failed, or unknown");
      need(verificationStates.has(payload.verification), "verification", "not_requested, verified, unverified, or unknown");
      need(payload.output === undefined || isRecord(payload.output), "output", "an optional object");
      if (payload.error !== undefined) {
        need(isRecord(payload.error), "error", "an optional object");
        if (isRecord(payload.error)) {
          need(isNonEmptyString(payload.error.code, 100), "error.code", "a non-empty string");
          need(isNonEmptyString(payload.error.message, 1000), "error.message", "a non-empty string");
        }
      }
      break;
    case "session.error":
      str("code", 100);
      str("message", 1000);
      need(typeof payload.retryable === "boolean", "retryable", "a boolean");
      break;
    default:
      errors.push("Unsupported event type: " + String(type));
  }
}

export function validateAmeEvent(value) {
  const errors = [];
  if (!isRecord(value)) return { valid: false, errors: ["event must be an object"] };
  if (value.protocolVersion !== AME_PROTOCOL_VERSION) {
    errors.push("protocolVersion must equal " + AME_PROTOCOL_VERSION);
  }
  if (!isNonEmptyString(value.eventId, 160)) errors.push("eventId must be a non-empty string");
  if (!isNonEmptyString(value.sessionId, 160)) errors.push("sessionId must be a non-empty string");
  if (value.turnId !== undefined && value.turnId !== null && !isNonEmptyString(value.turnId, 160)) {
    errors.push("turnId must be null or a non-empty string");
  }
  if (!Number.isSafeInteger(value.sequence) || value.sequence < 0) {
    errors.push("sequence must be a non-negative safe integer");
  }
  if (!isIsoDate(value.timestamp)) errors.push("timestamp must be an ISO-8601 date/time");
  if (!eventTypeSet.has(value.type)) errors.push("type is unsupported: " + String(value.type));
  if (!isRecord(value.payload)) errors.push("payload must be an object");
  if (eventTypeSet.has(value.type) && isRecord(value.payload)) {
    validatePayload(value.type, value.payload, errors);
  }
  return { valid: errors.length === 0, errors };
}

export function assertValidAmeEvent(value) {
  const result = validateAmeEvent(value);
  if (!result.valid) throw new TypeError("Invalid AME event: " + result.errors.join("; "));
  return value;
}

export function createAmeEvent({
  eventId, sessionId, turnId = null, sequence,
  timestamp = new Date().toISOString(), type, payload
}) {
  return assertValidAmeEvent({
    protocolVersion: AME_PROTOCOL_VERSION,
    eventId, sessionId, turnId, sequence, timestamp, type, payload
  });
}
