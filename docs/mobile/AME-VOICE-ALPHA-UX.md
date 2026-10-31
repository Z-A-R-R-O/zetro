# AME Voice Alpha — minimal UI and functional scope

**Product decision:** function first. Keep the first screen quiet, readable and fast. Do not build a dashboard, character, animated environment, visualizer or customization system in Voice Alpha.

## One primary screen

The home screen contains only:

1. **AME identity** — small wordmark and a plain connection state (Connected / Offline / Connecting).
2. **Conversation area** — user transcript and assistant response, newest content visible. No decorative cards around every message.
3. **One microphone control** — large enough to hit comfortably. Tap to start listening; tap again to stop. A clear listening state is required.
4. **Text fallback** — a small input affordance for noisy environments and accessibility.
5. **Stop / interrupt** — visible while AME is speaking or processing.
6. **Settings entry** — connection, voice output, microphone permission and diagnostics only.

## Interaction states

| State | What the user sees | Required behavior |
| --- | --- | --- |
| Idle | Mic button; connection state | Ready for a new turn |
| Listening | "Listening…" and active mic control | Capture audio; stop on tap; handle permission denial |
| Processing | "Thinking…" | Disable duplicate submit; allow cancel |
| Speaking | Response text and "Speaking…" | TTS playback; interrupt immediately |
| Offline | "Offline" and retry | Never pretend the request was sent |
| Error | One short actionable message | Preserve transcript; offer retry where safe |

Use labels and restrained color changes to communicate state. Animation is optional and must never be required to understand whether the microphone is active.

## Voice turn lifecycle

1. User explicitly starts listening.
2. Android speech recognizer returns partial and final transcript.
3. AME displays the final transcript before sending.
4. AME sends a user.turn event with a unique event ID, session ID, turn ID and sequence.
5. ZETRO returns assistant deltas and a terminal assistant.complete or session.error.
6. AME renders the answer and starts TTS if voice output is enabled.
7. User can interrupt TTS or cancel processing.
8. Lifecycle interruption, permission denial, network loss and app backgrounding are represented explicitly.

No always-on wake word in the first alpha. Add Android assistant role and optional wake word only after push-to-talk, foreground audio, cancellation and battery behavior are stable.

## Functional acceptance criteria

- Microphone permission is requested only after the user taps the mic.
- Permission denial leaves text input usable.
- A tap starts exactly one recording session; repeated taps cannot create parallel recognizers.
- Partial transcript is shown; final transcript is editable before send.
- Network failure is visible and does not erase the user's text.
- Reconnection does not duplicate a submitted turn.
- Responses render incrementally without layout jumps.
- TTS starts only after a valid assistant response and can be stopped.
- Incoming call, audio focus loss, app backgrounding and activity recreation clean up microphone/TTS resources.
- No audio or transcript is sent to analytics by default.
- The UI never exposes device actions until a capability is implemented, permission-checked and approval-gated.

## Non-goals for Voice Alpha

- Animated assistant avatar or 3D character.
- Complex glassmorphism, parallax or custom particle effects.
- Multi-tab dashboard, plugin marketplace or theme editor.
- Always-listening microphone or guaranteed background wake word.
- Autonomous messaging, calling, file access or broad Accessibility automation.
- Persistent personal memory or proactive notifications.

## Quality bar

The alpha is successful when a user can open AME, speak, see what was heard, receive a useful answer, hear it read aloud, interrupt it and recover cleanly from errors. Everything else waits.
