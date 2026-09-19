---
description: "专利分组导航：基于 DSH 的专利智能体概念验证——ctx.patentCore 业务真相服务，以及带模式策略与多专利隔离的模型可见专利工具，供维护者浏览本分组。"
kind: "package-group"
---

# packages/patent

[English](README.md) | 中文

## Summary

专利分组是构建在 DeepSeek Harness 之上的专利智能体概念验证。`patent-core` 承载专利业务真相——研发项目、专利档案、材料与技术事实——以及从会话日志折叠出的每会话专利上下文，通过 `ctx.patentCore` 暴露。`patent-tools` 在该服务之上注册模型可见工具，并落实设计所依赖的三根支柱:多专利隔离、仅限人工的事实确认、以及按模式限权的工具权限。专利业务数据存放在服务中而非 Harness 核心,因此即使替换 Agent 运行时也保持完整。

## Packages

| Package | Role | ctx key |
|---|---|---|
| [`patent-core`](patent-core/README.zh.md) | 同进程专利业务真相与每会话专利上下文 | `ctx.patentCore` |
| [`patent-tools`](patent-tools/README.zh.md) | 模型可见专利工具、模式策略与隔离落实 | — |

## Related documentation

- [架构](../../docs/architecture.zh.md) — 这些包所挂接的扩展点(`ctx.tools`、`tools/pre-execute`、会话投影)。
- [工具编写参考](../../docs/cookbook/adding-a-tool.zh.md) — 专利工具遵循的 `defineTool` 契约。

## Status

这是一个概念验证。`patent-core` 将记录保存在内存中;生产版本以产品设计中描述的每项目 SQLite 存储作为后端。特征、说明书、风险质检、导出与子代理编排暂缓实现。
