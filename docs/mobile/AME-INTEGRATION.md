# AME mobile integration plan

**Status:** protocol foundation started; gateway and Android adapter not yet implemented.

AME is the Android voice and device client. ZETRO is the cognitive/execution runtime. The two communicate through the versioned @veyminore/zetro-ame-protocol package.

## Current repository reality

The current ZETRO repository describes its executable slice as the Antigravity adapter and an offline synthetic RCT demo. Its generic computer runtime and dispatcher remain planned. Therefore, AME integration must not claim that ZETRO already exposes a general-purpose mobile assistant API or complete tool runtime.

The first integration deliverable is the protocol contract. A conversation adapter can be implemented only after a real ZETRO conversation/agent port is identified or introduced. Device operations must not bypass ZETRO's eventual action/policy pipeline.

## Ownership

| Area | Owner |
| --- | --- |
| Microphone, audio focus, ASR, TTS, Android lifecycle | AME Android |
| Android assistant role and voice-interaction session | AME Android |
| Device permission prompts and local capability availability | AME Android |
| Conversation orchestration and model/provider access | ZETRO adapter, once the relevant runtime port exists |
| Intent planning and approved task graph | ZETRO |
| Capability policy and approval decision | ZETRO policy boundary |
| Device-side execution and OS permission enforcement | AME capability runtime |
| Result receipt and evidence | AME reports observations; ZETRO records and evaluates them |

## Transport

Use an outbound TLS WebSocket session from Android to a trusted gateway. Do not expose an unauthenticated inbound phone-control server. Pair the device explicitly, issue revocable device credentials, and authenticate independently of the event payload.

Requirements for the future gateway:

- TLS only; authenticated device identity; revocable credentials.
- Per-session sequence numbers and duplicate-event rejection.
- Bounded message sizes, event rates and concurrent sessions.
- Reconnect with backoff and explicit session resumption semantics.
- No model/provider secrets in the APK.
- No action dispatch from raw model text.
- No action replay after uncertain external effects.

## Capability dispatch

A ZETRO plan may propose a namespaced capability such as timer.create. The AME client reports which capabilities are installed and currently available. Before execution, ZETRO checks the principal, device, session, resource scope, expiry and approval requirement. An approval-required execution must carry a one-use approval ID and a digest of the exact normalized request; AME must reject a missing or mismatched approval. AME independently checks OS permission and local support. The result reports state, effect and verification separately.

Initial candidate capabilities, each implemented independently:

- app.open
- timer.create
- alarm.create
- calendar.read
- calendar.create
- contacts.search
- notification.list
- call.initiate
- message.draft
- message.send

High-impact actions such as sending messages or initiating calls require contextual confirmation. No arbitrary shell execution, root access or unrestricted Accessibility automation.

## Delivery slices

1. **Protocol v0.1:** event envelope, payload checks and contract tests. (Started in this branch.)
2. **Android client baseline:** build and test the selected Android foundation; preserve upstream attribution and third-party notices.
3. **Voice Alpha:** push-to-talk, ASR, response display, TTS, cancellation and lifecycle cleanup using a demo backend.
4. **ZETRO conversation adapter:** integrate only against an actual ZETRO conversation/agent port; do not invent one.
5. **Authenticated gateway:** device pairing, WebSocket events, replay/sequence controls and reconnect behavior.
6. **First capability:** timer.create, end-to-end policy check, user-visible result and tests.
7. **System assistant integration:** VoiceInteractionService / session implementation and supported invocation testing.
8. **Memory, visual context and proactive tasks:** only after user controls, storage and privacy design are in place.

## Release gates

- Contract tests pass on both sides.
- Unknown protocol version/event type is rejected.
- Missing/revoked/expired grant blocks execution.
- Changed request invalidates approval.
- Duplicate event does not duplicate an action.
- Device permission denial is reported accurately.
- Failed/uncertain execution is never reported as verified success.
- Raw audio and sensitive transcript content are excluded from default telemetry.

## Repository choice

Keep the Android app in a dedicated AME-Android repository. The existing Z-A-R-R-O/Ame repository currently describes a birthday love-letter website and is not the Android assistant repository, so it must remain untouched. ZETRO owns the shared protocol and its future adapter.
