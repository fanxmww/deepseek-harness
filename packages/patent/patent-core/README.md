---
description: "The in-process patent business-truth service (ctx.patentCore): projects, patent cases, materials, technical facts, and the per-session patent context folded from the session log, for maintainers building patent tooling on it."
kind: "package-reference"
---

# @deepseek-ai/dsh-patent-core

English | [中文](README.zh.md)

## Summary

`dsh-patent-core` is the single owner of patent business truth in the patent-agent proof of concept. It holds projects, patent cases, materials, and technical facts, and folds the per-session patent context from the session log so an agent cannot rewrite its own bound `patentId`. Model-facing tools call `ctx.patentCore` and never touch storage directly, so multi-patent isolation and confirmation audit are enforced in one place. Records are in memory for the PoC; the durable facts that must survive a reload — the bound context and each human confirmation — are appended as session events.

## Use this package

Mount the service, seed data through its create methods, then bind a session to a patent before running patent tools:

```ts
await ctx.plugin(PatentCore)
const project = ctx.patentCore.createProject({ workspaceId, name: 'Smart scheduling' })
const patent = ctx.patentCore.createPatentCase({ projectId: project.id, title: 'Dynamic weighting' })
ctx.patentCore.importMaterial({ patentId: patent.id, title: 'spec', text: '…' })
ctx.patentCore.bindContext(agent, { workspaceId, projectId: project.id, patentId: patent.id, mode: 'strict' })
```

The host calls `bindContext`; it appends `patent/context-bound`, so the binding is reconstructable from the log and drives the `patentContext` projection. Every patent-scoped read or mutation resolves the caller's bound context and rejects access outside it — `assertPatentScope` is the execution-layer isolation check each tool runs, and `confirmFact` appends `patent/fact-confirmed` as the durable audit record of a human approval.

## Session events and projection

- `patent/context-bound` — the patent context a session is bound to (host-injected, whole-value last-wins). Drives the `patentContext` projection.
- `patent/fact-confirmed` — a human confirmed a candidate fact; an agent cannot produce it without approval.

## Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The `PatentCore` service, its `patentContext` projection, and `PatentError` |
| [`src/types.ts`](src/types.ts) | Branded ids, domain records, and the one home of the patent session-event and projection-key declarations |

## Known Limitations and Deferred Work

- **In-memory storage** — records do not persist across process restarts; the per-project SQLite store is deferred.
- **No feature tree, specification, risk checks, or export** — the PoC covers projects, patents, materials, and the fact lifecycle only.
