# ADR-001: Build the computer runtime before orchestration

- **Status:** accepted as product direction
- **Date:** 2026-10-06
- **Source:** user-provided “ZETRO — Reborn” concept

## Context

The former Veyrezio concept centered on dispatching Antigravity workers. The new ZETRO concept aims to expose controlled computer execution to any agent and then add coding environment orchestration.

## Decision

Build ZETRO Computer as a standalone local product with sessions, capability policy, computer/system providers, audit and verifiable results. Introduce Antigravity through a generic adapter in Phase 2. Keep project profiles and worker counts as configuration data. Core runtime modules cannot depend on Antigravity or fixed AGR/ORW roles.

## Consequences

Phase 1 delivers value independently and can be tested with mock agents and fixture applications. Phase 2 must use the same action and evidence contracts. The additional abstraction costs some early design effort, while reducing the risk that one external environment defines the entire product.

## Reversal trigger

Revisit only if the standalone runtime fails a documented user workflow or the generic adapter boundary makes verified execution materially less reliable. Record evidence and migration impact in a new ADR.
