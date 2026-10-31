export type AmeRisk = "low" | "medium" | "high";
export type AmeApprovalDecision = "approved" | "denied";
export type AmeActionState = "completed" | "failed" | "cancelled" | "unknown";
export type AmeEffectState = "not_attempted" | "executed" | "failed" | "unknown";
export type AmeVerificationState = "not_requested" | "verified" | "unverified" | "unknown";

export interface AmeEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  protocolVersion: "0.1";
  eventId: string;
  sessionId: string;
  turnId?: string | null;
  sequence: number;
  timestamp: string;
  type: string;
  payload: TPayload;
}

export interface AmeCapabilityExecution {
  executionId: string;
  capabilityId: string;
  input: Record<string, unknown>;
  grantId: string;
  approvalId?: string;
  requiresApproval: boolean;
  requestDigest?: string;
  expiresAt: string;
}

export interface AmeCapabilityResult {
  executionId: string;
  state: AmeActionState;
  effect: AmeEffectState;
  verification: AmeVerificationState;
  output?: Record<string, unknown>;
  error?: { code: string; message: string };
}

export const AME_PROTOCOL_VERSION: "0.1";
export const AME_EVENT_TYPES: readonly string[];
export function validateAmeEvent(value: unknown): { valid: boolean; errors: string[] };
export function assertValidAmeEvent<T>(value: T): T;
export function createAmeEvent<TPayload extends Record<string, unknown>>(input: {
  eventId: string;
  sessionId: string;
  turnId?: string | null;
  sequence: number;
  timestamp?: string;
  type: string;
  payload: TPayload;
}): AmeEvent<TPayload>;
