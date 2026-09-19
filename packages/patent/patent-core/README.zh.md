---
description: "同进程专利业务真相服务(ctx.patentCore):研发项目、专利档案、材料、技术事实,以及从会话日志折叠出的每会话专利上下文,供在其上构建专利工具的维护者使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-patent-core

[English](README.md) | 中文

## Summary

`dsh-patent-core` 是专利智能体概念验证中专利业务真相的唯一拥有者。它保存研发项目、专利档案、材料与技术事实,并从会话日志折叠出每会话的专利上下文,使 Agent 无法改写自己绑定的 `patentId`。模型可见工具调用 `ctx.patentCore` 而从不直接触碰存储,因此多专利隔离与确认审计在同一处落实。PoC 中记录保存在内存;必须在重载后存续的持久事实——绑定的上下文与每次人工确认——以会话事件形式追加。

## Use this package

先挂载服务,通过其创建方法录入数据,再将会话绑定到某专利,然后运行专利工具:

```ts
await ctx.plugin(PatentCore)
const project = ctx.patentCore.createProject({ workspaceId, name: 'Smart scheduling' })
const patent = ctx.patentCore.createPatentCase({ projectId: project.id, title: 'Dynamic weighting' })
ctx.patentCore.importMaterial({ patentId: patent.id, title: 'spec', text: '…' })
ctx.patentCore.bindContext(agent, { workspaceId, projectId: project.id, patentId: patent.id, mode: 'strict' })
```

宿主调用 `bindContext`;它追加 `patent/context-bound`,因此绑定可从日志重建并驱动 `patentContext` 投影。每个专利级读取或修改都会解析调用方绑定的上下文并拒绝越界访问——`assertPatentScope` 是每个工具执行时运行的执行层隔离校验,`confirmFact` 追加 `patent/fact-confirmed` 作为一次人工确认的持久审计记录。

## Session events and projection

- `patent/context-bound` — 会话绑定到的专利上下文(宿主注入,整值最后写入者胜)。驱动 `patentContext` 投影。
- `patent/fact-confirmed` — 人工确认了某候选事实;Agent 无法在没有审批的情况下产生它。

## Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `PatentCore` 服务、其 `patentContext` 投影,以及 `PatentError` |
| [`src/types.ts`](src/types.ts) | 品牌 id、领域记录,以及专利会话事件与投影键声明的唯一归属 |

## Known Limitations and Deferred Work

- **内存存储** — 记录不跨进程重启存续;每项目 SQLite 存储暂缓。
- **无特征树、说明书、风险质检或导出** — PoC 仅覆盖研发项目、专利、材料与事实生命周期。
