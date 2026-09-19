---
description: "dsh 专利 bundle:一个 cordis.patch.yml,在 dsh-base 之上挂载专利业务真相服务与专利工具,以及叠加它的 patent profile,供组装专利智能体的维护者使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-patent

[English](README.md) | 中文

## Summary

`dsh-patent` 是一个 profile bundle,其substance 是它的 `cordis.patch.yml`:在 `dsh-base` 之上插入 `patent-core` 服务与 `patent-tools` 两行。叠加在 `dsh-base` 与一个 runner bundle 之后,它把一次普通的 dsh 会话变成专利工作台。随附的 `patent` profile 叠加 `dsh-base`、`dsh-headless` 与本 bundle,因此 `dsh --profile patent "<task>"` 可运行一次性专利智能体。

## Use this package

本 bundle 通过随附的 `patent` profile 选择:

```sh
dsh --profile patent "extract candidate facts for the current patent"
```

若要组装进其他 profile,在该 profile 的 `dsh.profile.bundles` 中,于 `@deepseek-ai/dsh-base`(以及一个 runner,如 `@deepseek-ai/dsh-headless` 或 `@deepseek-ai/dsh-web-app`)之后加入 `@deepseek-ai/dsh-patent`。base 提供插入行依赖的会话存储、会话投影与工具注册表。在专利工具运作前,先将会话绑定到某专利(`ctx.patentCore.bindContext`)。

## Source map

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | 插入 `patent-core` 与 `patent-tools` 的 patch 列表 |
| [`src/index.ts`](src/index.ts) | 空模块;bundle 的substance 是 patch 文件 |

## Model Experience

Indirectly, through each inserted row's package, which owns that row's model-facing behavior.

#### KV Cache effect

bundle 自身不添加任何请求前缀;缓存效应由各插入行的包拥有。

## Known Limitations and Deferred Work

- **需要基于 base 的 profile** — 插入行假定 `dsh-base` 服务;本 bundle 不能独立运行。
- **PoC 范围** — bundle 不随附专用 Web 卡片或桌面导航;专利工作台 UI 暂缓。
