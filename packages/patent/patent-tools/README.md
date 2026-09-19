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

## Known Limitations and Deferred Work

- **Positive confirmation needs a wired approval channel** — through the loop, `confirm_fact` is denied without `ctx.approval`; the human-approved path is exercised via the service in the test.
- **PoC tool set** — feature-tree, claim-generation, specification, risk-check, and export tools are deferred.
