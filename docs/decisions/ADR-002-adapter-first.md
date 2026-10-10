# ADR-002: Build the Antigravity connection slice first

- **Status:** accepted
- **Date:** 2026-10-08
- **Source:** product owner direction to connect AGR-1 through AGR-5 before the rest of ZETRO

## Context

ADR-001 established the long-term boundary: a standalone computer runtime, then orchestration through adapters. The product owner has now supplied five concrete Antigravity conversation IDs and prioritized a working connection tool as the first build.

## Decision

Implement a narrow Antigravity adapter and CLI first. It uses Antigravity's bundled `agentapi`, validates exact conversation/project/workspace identity, submits once, and reports submission separately from completion. This does not pull Antigravity assumptions into the generic ZETRO Core. Worktree dispatch, planning and autonomous execution wait for policy, durable state and evidence contracts.

## Consequences

The team gets a real integration test early and can discover Antigravity limitations before designing the dispatcher. The adapter may need transport changes when Antigravity updates. It cannot report verified task completion until a supported observation path or independent worktree checks exist.

## Reversal trigger

If Antigravity removes or changes `agentapi`, migrate the adapter to a documented supported surface while retaining the same identity and result semantics. Do not weaken checks to preserve a superficially successful send.
