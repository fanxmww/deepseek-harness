---
description: "The model-facing patent tools with mode policy and multi-patent isolation over ctx.patentCore, for maintainers composing or debugging the patent agent proof of concept."
kind: "package-reference"
---

# @deepseek-ai/dsh-patent-tools

English | [中文](README.zh.md)

## Summary

`dsh-patent-tools` registers the model-facing patent tools and the policy around them. Every tool calls `ctx.patentCore` and re-validates the bound patent scope inside `execute`, so isolation holds even when a caller skips the policy layer. A `tools/pre-execute` listener enforces the generation mode and routes fact confirmation through human approval. It demonstrates the three pillars of the patent-agent design: multi-patent isolation, human-only fact confirmation, and mode-gated tool permission.

## Tools

| Tool | Purpose | Policy |
|---|---|---|
| `search_materials` | Search the bound patent's materials | Rejects an explicit cross-patent `patentId` at execution |
| `create_fact_candidate` | Record a candidate fact | Denied in `strict` mode |
| `confirm_fact` | Confirm a candidate into the fact base | Always requires human approval (`ask`); an agent cannot self-confirm |
| `list_confirmed_facts` | List confirmed facts of the bound patent | — |

## Use this package

```ts
await ctx.plugin(PatentCore)
await ctx.plugin(PatentTools)
```

The mode policy reads the session's bound `PatentContext` (from `ctx.patentCore`): `confirm_fact` returns an `ask` decision routed to `ctx.approval`, and `create_fact_candidate` is denied in `strict` mode. Without an approval channel, `confirm_fact` is denied — the agent cannot confirm a fact on its own.

## Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Tool registrations, the `tools/pre-execute` mode policy, and the pure `modeDecision` rule |
| [`tests/patent-tools.spec.ts`](tests/patent-tools.spec.ts) | Full-loop test: a mock model drives the real tools; asserts isolation, confirmation, and mode gating |

## Model Experience

### Tool definitions

#### What the model sees

The model sees the patent tool definitions listed above: `search_materials`, `create_fact_candidate`, `confirm_fact`, `list_confirmed_facts`, `build_feature`, `generate_claims`, `save_claim_version`, and `run_quality_checks`, each with task-relevant parameters only.

#### Token effect

Fixed schema cost on every request where the tools are visible; the descriptions and parameters are static for a given composition.

#### KV Cache effect

Prefix-stable while the definitions and visibility are unchanged; plugin lifecycle or scoped restrictions may invalidate reuse from these schemas.

### Tool-call history and result

#### What the model sees

Each result is small and fixed-shape: a scoped material list, a candidate or confirmed fact id, three claim plans, a saved claim-version id, or a risk-finding list. A denied call returns a stable error — a strict-mode denial for `create_fact_candidate`, a cross-patent rejection, or an approval-required rejection for `confirm_fact`.

#### Token effect

Result size grows with the returned lists (materials, facts, claim plans, risks); each result is otherwise compact and fixed-shape.

#### KV Cache effect

Append-only; results follow the reusable request prefix and do not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Positive confirmation needs a wired approval channel** — through the loop, `confirm_fact` is denied without `ctx.approval`; the human-approved path is exercised via the service in the test.
- **PoC tool set** — specification generation, cross-patent overlap analysis, and export tools are deferred; claim generation is deterministic rather than model-authored.
