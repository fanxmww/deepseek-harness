---
description: "The dsh patent bundle: a cordis.patch.yml that mounts the patent business-truth service and patent tools over dsh-base, and the patent profile that stacks it, for maintainers composing the patent agent."
kind: "package-reference"
---

# @deepseek-ai/dsh-patent

English | [中文](README.zh.md)

## Summary

`dsh-patent` is a profile bundle whose substance is its `cordis.patch.yml`: it inserts the `patent-core` service and the `patent-tools` rows over `dsh-base`. Stacked after `dsh-base` and a runner bundle, it turns an ordinary dsh session into a patent workbench. The shipped `patent` profile stacks `dsh-base`, `dsh-headless`, and this bundle, so `dsh --profile patent "<task>"` runs a one-shot patent agent.

## Use this package

The bundle is selected through the shipped `patent` profile:

```sh
dsh --profile patent "extract candidate facts for the current patent"
```

To compose it into another profile, add `@deepseek-ai/dsh-patent` after `@deepseek-ai/dsh-base` (and a runner such as `@deepseek-ai/dsh-headless` or `@deepseek-ai/dsh-web-app`) in that profile's `dsh.profile.bundles`. Base provides the session store, session projections, and tool registry the inserted rows depend on. Bind a session to a patent (`ctx.patentCore.bindContext`) before the patent tools operate.

## Source map

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | The patch list inserting `patent-core` and `patent-tools` |
| [`src/index.ts`](src/index.ts) | Empty module; the bundle's substance is the patch file |

## Model Experience

Indirectly, through each inserted row's package, which owns that row's model-facing behavior.

#### KV Cache effect

The bundle itself adds no request prefix; each inserted row's package owns any cache effect.

## Known Limitations and Deferred Work

- **Requires a base-backed profile** — the inserted rows assume `dsh-base` services; the bundle does not stand alone.
- **PoC scope** — no dedicated Web cards or desktop navigation ship with the bundle; the patent workbench UI is deferred.
