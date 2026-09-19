/**
 * The bundle's substance is its patch file: the `dsh.bundle.patch` manifest
 * field must name a real, parseable patch list that inserts the patent service
 * and tools, and every bare plugin name must be a declared dependency so the
 * profile composer can resolve it.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

interface Manifest {
  dependencies?: Record<string, string>
  dsh?: { bundle?: { patch?: string } }
}

interface Row {
  id?: string
  name?: string
  inject?: string[]
}

describe('dsh-patent bundle', () => {
  it('declares a patch list that mounts patent-core and patent-tools from declared dependencies', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as Manifest
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')

    const parsed = yaml.load(
      readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    )
    expect(Array.isArray(parsed)).toBe(true)
    const rows = (parsed as { insert?: Row[] }[]).flatMap(patch => patch.insert ?? [])

    const core = rows.find(row => row.id === 'patent-core')
    const tools = rows.find(row => row.id === 'patent-tools')
    expect(core?.name).toBe('@deepseek-ai/dsh-patent-core')
    expect(tools?.name).toBe('@deepseek-ai/dsh-patent-tools')
    expect(tools?.inject).toContain('patentCore')

    for (const row of rows) {
      expect(manifest.dependencies).toHaveProperty(row.name!)
    }
  })
})
