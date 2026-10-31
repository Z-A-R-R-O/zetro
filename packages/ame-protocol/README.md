# AME Protocol

Versioned event contract shared by the AME Android client and the ZETRO-side AME adapter.

## Status

Protocol foundation v0.1. This package validates event envelopes and a small set of payload invariants. It is **not** a production gateway, authentication layer, capability policy engine, conversation model or Android implementation.

## Event flow

    AME Android                    ZETRO AME adapter
        |                                  |
        | session.open ------------------->|
        |<---------------- session.accepted|
        | user.turn ---------------------->|
        |<---------------- assistant.delta|
        |<--------------- assistant.complete
        |<------------ capability.proposed|
        |<-------------- approval.required|
        | approval.decided -------------->|
        |<------------- capability.execute|
        | capability.result ------------->|

## Invariants

- Every event carries protocolVersion, eventId, sessionId, sequence, timestamp, type and object payload.
- turnId is optional and may be null for session-level events.
- Transport authentication is out-of-band; bearer tokens and secrets must never be embedded in event payloads.
- A capability ID is namespaced, such as timer.create or contacts.search.
- capability.execute must contain a scoped grantId, an expiry and a requiresApproval flag. When requiresApproval is true, it must also contain approvalId and requestDigest, binding the one-use approval to the exact normalized request.
- state, effect and verification are separate. completed does not imply verified.
- Android validates that a capability exists locally and is permitted before performing it. ZETRO validates policy immediately before dispatch.
- Unknown protocol versions and event types are rejected.

## Tests

    pnpm --filter @veyminore/zetro-ame-protocol test

## Deliberate non-goals

This protocol does not provide authentication, transport encryption, replay protection storage, capability-specific schemas, approval UX, model inference, audio streaming or device control. Those belong to separately tested components.
