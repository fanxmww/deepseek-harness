---
description: "基于 ctx.patentCore、带模式策略与多专利隔离的模型可见专利工具,供组装或调试专利智能体概念验证的维护者使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-patent-tools

[English](README.md) | 中文

## Summary

`dsh-patent-tools` 注册模型可见专利工具及其周边策略。每个工具都调用 `ctx.patentCore`,并在 `execute` 内重新校验绑定的专利范围,因此即使调用方绕过策略层,隔离仍然成立。一个 `tools/pre-execute` 监听器落实生成模式,并将事实确认路由到人工审批。它演示了专利智能体设计的三根支柱:多专利隔离、仅限人工的事实确认、以及按模式限权的工具权限。

## Tools

| Tool | Purpose | Policy |
|---|---|---|
| `search_materials` | 搜索绑定专利的材料 | 执行时拒绝显式跨专利 `patentId` |
| `create_fact_candidate` | 记录候选事实 | `strict` 模式下拒绝 |
| `confirm_fact` | 将候选确认进事实库 | 始终需要人工审批(`ask`);Agent 无法自行确认 |
| `list_confirmed_facts` | 列出绑定专利的已确认事实 | — |

## Use this package

```ts
await ctx.plugin(PatentCore)
await ctx.plugin(PatentTools)
```

模式策略读取会话绑定的 `PatentContext`(来自 `ctx.patentCore`):`confirm_fact` 返回路由到 `ctx.approval` 的 `ask` 决策,`create_fact_candidate` 在 `strict` 模式下被拒绝。没有审批通道时,`confirm_fact` 被拒绝——Agent 无法自行确认事实。

## Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | 工具注册、`tools/pre-execute` 模式策略,以及纯函数 `modeDecision` 规则 |
| [`tests/patent-tools.spec.ts`](tests/patent-tools.spec.ts) | 全循环测试:mock 模型驱动真实工具;断言隔离、确认与模式限权 |

## Known Limitations and Deferred Work

- **正向确认需要接好审批通道** — 通过循环时,`confirm_fact` 在没有 `ctx.approval` 时被拒绝;人工审批路径在测试中经由服务验证。
- **PoC 工具集** — 特征树、权利要求生成、说明书、风险质检与导出工具暂缓。
