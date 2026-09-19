---
description: "The patent group map: an on-DSH patent-agent proof of concept — the ctx.patentCore business-truth service and the model-facing patent tools with mode policy and multi-patent isolation, for maintainers navigating the group."
kind: "package-group"
---

# packages/patent

English | [中文](README.zh.md)

## Summary

The patent group is a proof of concept for a patent agent built on DeepSeek Harness. `patent-core` owns the patent business truth — projects, patent cases, materials, and technical facts — plus the per-session patent context folded from the session log, exposed as `ctx.patentCore`. `patent-tools` registers the model-facing tools over that service and enforces the three pillars the design depends on: multi-patent isolation, human-only fact confirmation, and mode-gated tool permission. Patent business data lives in the service rather than the harness core, so it stays intact if the agent runtime is replaced.

## Packages

| Package | Role | ctx key |
|---|---|---|
| [`patent-core`](patent-core/README.md) | In-process patent business truth and per-session patent context | `ctx.patentCore` |
| [`patent-tools`](patent-tools/README.md) | Model-facing patent tools, mode policy, and isolation enforcement | — |

## Related documentation

- [Architecture](../../docs/architecture.md) — the extension points these packages attach to (`ctx.tools`, `tools/pre-execute`, session projections).
- [Tool authoring reference](../../docs/cookbook/adding-a-tool.md) — the `defineTool` contract the patent tools follow.

## Status

This is a proof of concept. `patent-core` keeps records in memory; a production build backs them with the per-project SQLite store described in the product design. Feature, specification, risk-check, export, and subagent orchestration are deferred.
