# ZETRO capability catalog

**Status:** proposed. Capability names are logical contract names; MCP and CLI names are generated/mapped from them. `R` means read/observe, `M` local mutation, `X` execution, `G` exact-action gate, and `U` unsupported initially. Every operation also requires session-level authorization.

## Computer

| Family | Operations | Earliest slice | Authority and verification notes |
| --- | --- | --- | --- |
| Screen | `screen.displays`, `screen.capture`, `screen.region` | 1A | R; artifacts are sensitive; include display, scale, timestamp, revision |
| Screen analysis | `screen.pixel`, `screen.changed`, `screen.findText`, `screen.find` | 1E | R; candidate provenance and confidence; never infer authority from a match |
| Windows | `window.list`, `window.active` | 1A | R; title/process metadata may be sensitive |
| Windows | `window.focus` | 1B | M; handle identity and generation required |
| Windows | `window.move`, `window.resize`, `window.minimize`, `window.maximize`, `window.restore`, `window.close` | Later | M; close can lose work and may require G |
| Mouse | `mouse.position` | 1A | R |
| Mouse | `mouse.move`, `mouse.click`, `mouse.doubleClick`, `mouse.rightClick`, `mouse.middleClick`, `mouse.scroll` | 1B | M; input lease, target freshness, action receipt |
| Mouse | `mouse.drag`, `mouse.press`, `mouse.release` | Later | M; held-button cleanup on cancellation/crash |
| Keyboard | `keyboard.type`, `keyboard.press`, `keyboard.hotkey` | 1B | M; active-window check; never log typed secrets |
| Keyboard | `keyboard.keyDown`, `keyboard.keyUp`, `keyboard.paste` | Later | M; held-key cleanup; paste may expose clipboard |
| Clipboard | `clipboard.read`, `clipboard.write` | 1C | R/M; explicit grant, restricted retention |

## System and browser

| Family | Operations | Earliest slice | Authority and verification notes |
| --- | --- | --- | --- |
| Filesystem | `fs.list`, `fs.read`, `fs.exists`, `fs.stat` | 1C | R; canonical path scope; content may be secret |
| Filesystem | `fs.write` | 1C | M; atomic replacement where supported; verify hash when requested |
| Filesystem | `fs.copy`, `fs.move`, `fs.patch`, `fs.diff`, `fs.search` | Later | R/M by effect; patch requires preimage check |
| Filesystem | `fs.delete` | Later | G; exact path set, recovery option where practical |
| Shell | `shell.exec` | 1C | X; finite deadline, explicit cwd/env, bounded output |
| Shell | `shell.spawn`, `shell.stream`, `shell.kill` | Later | X/M; process ownership and cleanup protocol needed |
| Shell | `shell.cwd`, `shell.env` | 1C | R; only session-visible data; redact secrets |
| Browser | `browser.open`, `browser.navigate`, `browser.tabs`, `browser.extract`, `browser.screenshot` | 1D | R/M; managed context; network destinations may be scoped |
| Browser | `browser.click`, `browser.type`, `browser.scroll`, `browser.back`, `browser.forward` | 1D | M; locator freshness; external effects gated |
| Process | list/status | Later | R; process metadata may be sensitive |
| Process | start/kill | Later | X/G depending on target; ownership rules required |
| Audio/speech | `audio.record`, `audio.play`, `speech.listen`, `speech.speak` | Later | R/M; explicit microphone and speaker consent, retention rules |

## High-level operations

`target.find` resolves candidates only. `target.act` performs a fresh policy check and revalidates target identity. `action.verify` evaluates a predicate over new evidence; it does not repeat an action. `workflow.run` may chain bounded steps only after per-step policy and deadline checks. A workflow cannot inherit broader authority than its session.

## Gated effects

Deleting data, sending external messages, publishing, purchasing, deploying, modifying system settings or accessing credentials are separate effect categories. A generic click, shell command or browser navigation can cause these effects, so tools must expose exact targets and the operator must define policy for high-impact workflows. Where effect classification is uncertain, ZETRO reports uncertainty and asks for confirmation; the platform does not claim perfect semantic detection.

## Mapping to public interfaces

MCP tools and HTTP routes should be generated from or checked against this catalog. For example, `mouse.click` maps to a typed `zetro_mouse_click` tool and an action kind, while `zetro_action_verify` maps to a verifier action. Interface naming can evolve, but capability, scope and result semantics remain identical. Add a contract test whenever an operation is exposed on a second interface.
