import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import PatentCore from '@deepseek-ai/dsh-patent-core'
import type { OperatorId, PatentCase, PatentMode, WorkspaceId } from '@deepseek-ai/dsh-patent-core'
import * as PatentTools from '@deepseek-ai/dsh-patent-tools'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

/**
 * Full-loop integration: a scripted mock model drives the REAL patent tools
 * through the agent loop. Only the model is mocked; the tools, the patent-core
 * service, the mode policy, and the session log are real. The pillars under
 * test are multi-patent isolation, human-only fact confirmation, and
 * mode-gated tool permission.
 */
async function harness(adapter: MockAdapter): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(PatentCore)
  await ctx.plugin(PatentTools)
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

/** Seed one project with two sibling patents and their scoped materials. */
function seedTwoPatents(ctx: Context): { a: PatentCase; b: PatentCase } {
  const project = ctx.patentCore.createProject({
    workspaceId: brandString<WorkspaceId>('WS-1'),
    name: 'Smart scheduling',
  })
  const a = ctx.patentCore.createPatentCase({ projectId: project.id, title: 'Dynamic weighting', defaultMode: 'strict' })
  const b = ctx.patentCore.createPatentCase({ projectId: project.id, title: 'Fault recovery', defaultMode: 'strict' })
  ctx.patentCore.importMaterial({ patentId: a.id, title: 'A-spec', text: 'dynamic weight adjustment on device fault' })
  ctx.patentCore.importMaterial({ patentId: a.id, title: 'A-notes', text: 'threshold triggers reweighting' })
  ctx.patentCore.importMaterial({ patentId: b.id, title: 'B-spec', text: 'redundant failover controller' })
  return { a, b }
}

function bind(ctx: Context, agent: Agent, patent: PatentCase, mode: PatentMode): void {
  ctx.patentCore.bindContext(agent, {
    workspaceId: brandString<WorkspaceId>('WS-1'),
    projectId: patent.projectId,
    patentId: patent.id,
    mode,
  })
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

/** One tool result's outcome and rendered text. */
interface ToolOutcome {
  isError: boolean
  text: string
}

/** Extract the outcome and rendered text of each tool result in call order. */
function toolOutcomes(log: readonly SessionEvent[]): ToolOutcome[] {
  const outcomes: ToolOutcome[] = []
  for (const event of log) {
    if (event.type !== 'tool/result') continue
    const block = event.data.message.content[0]
    if (block === undefined || block.type !== 'tool-result') continue
    const inner = block.content[0]
    outcomes.push({
      isError: block.isError === true,
      text: inner !== undefined && inner.type === 'text' ? inner.text : '',
    })
  }
  return outcomes
}

/** Resolve one required tool outcome, failing the test when it is absent. */
function outcomeAt(outcomes: readonly ToolOutcome[], index: number): ToolOutcome {
  const outcome = outcomes[index]
  if (outcome === undefined) throw new Error(`expected a tool outcome at index ${index}`)
  return outcome
}

async function runOnce(ctx: Context, agent: Agent, prompt: string): Promise<void> {
  agent.followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }))
  await waitForIdle(ctx, agent)
}

describe('patent tools through the agent loop', () => {
  it('isolation: search returns only the bound patent, and a cross-patent id is denied at execution', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'search_materials', { query: 'weight' }),
      toolCallResponse('c2', 'search_materials', { patentId: 'PAT-other' }),
      textResponse('done'),
    ])
    const ctx = await harness(adapter)
    const { a } = seedTwoPatents(ctx)
    const agent = await ctx.agentLoop.create(SessionId('it-iso'), { provider: 'mock', model: 'mock' })
    bind(ctx, agent, a, 'strict')

    await runOnce(ctx, agent, 'search then cross')
    const outcomes = toolOutcomes(agent.session.snapshotEvents())
    expect(outcomes).toHaveLength(2)
    expect(outcomeAt(outcomes, 0).isError).toBe(false)
    expect(outcomeAt(outcomes, 0).text).toContain('2 material(s) matched')
    expect(outcomeAt(outcomes, 1).isError).toBe(true)
    expect(outcomeAt(outcomes, 1).text.toLowerCase()).toContain('cross-patent')
  })

  it('human confirmation: an agent calling confirm_fact is denied because approval is required', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'create_fact_candidate', { content: 'threshold triggers reweighting' }),
      toolCallResponse('c2', 'confirm_fact', { factId: 'FACT-anything', operator: 'agent' }),
      textResponse('cannot self-confirm'),
    ])
    const ctx = await harness(adapter)
    const { a } = seedTwoPatents(ctx)
    const agent = await ctx.agentLoop.create(SessionId('it-confirm'), { provider: 'mock', model: 'mock' })
    bind(ctx, agent, a, 'suggest')

    await runOnce(ctx, agent, 'record then confirm')
    const outcomes = toolOutcomes(agent.session.snapshotEvents())
    expect(outcomeAt(outcomes, 0).isError).toBe(false)
    expect(outcomeAt(outcomes, 1).isError).toBe(true)
    expect(outcomeAt(outcomes, 1).text.toLowerCase()).toContain('approval')
    expect(agent.session.snapshotEvents().some(e => e.type === 'patent/fact-confirmed')).toBe(false)
  })

  it('mode policy: strict mode denies create_fact_candidate', async () => {
    const ctx = await harness(new MockAdapter([
      toolCallResponse('c1', 'create_fact_candidate', { content: 'a new fact' }),
      textResponse('strict blocked'),
    ]))
    const { a } = seedTwoPatents(ctx)
    const agent = await ctx.agentLoop.create(SessionId('it-strict'), { provider: 'mock', model: 'mock' })
    bind(ctx, agent, a, 'strict')

    await runOnce(ctx, agent, 'try to add a fact in strict mode')
    const outcomes = toolOutcomes(agent.session.snapshotEvents())
    expect(outcomeAt(outcomes, 0).isError).toBe(true)
    expect(outcomeAt(outcomes, 0).text.toLowerCase()).toContain('strict mode')
  })

  it('mode policy: suggest mode allows create_fact_candidate', async () => {
    const ctx = await harness(new MockAdapter([
      toolCallResponse('c1', 'create_fact_candidate', { content: 'a new fact' }),
      textResponse('suggest allowed'),
    ]))
    const { a } = seedTwoPatents(ctx)
    const agent = await ctx.agentLoop.create(SessionId('it-suggest'), { provider: 'mock', model: 'mock' })
    bind(ctx, agent, a, 'suggest')

    await runOnce(ctx, agent, 'add a fact in suggest mode')
    const outcomes = toolOutcomes(agent.session.snapshotEvents())
    expect(outcomeAt(outcomes, 0).isError).toBe(false)
  })

  it('confirmation path: a human confirmation records the fact and appends patent/fact-confirmed', async () => {
    const ctx = await harness(new MockAdapter([]))
    const { a } = seedTwoPatents(ctx)
    const agent = await ctx.agentLoop.create(SessionId('it-human'), { provider: 'mock', model: 'mock' })
    bind(ctx, agent, a, 'suggest')

    const candidate = ctx.patentCore.createFactCandidate(agent.session, 'threshold triggers reweighting')
    const confirmed = ctx.patentCore.confirmFact(agent.session, candidate.id, brandString<OperatorId>('USER-1'))
    expect(confirmed.status).toBe('confirmed')
    expect(ctx.patentCore.listFacts(agent.session, { status: 'confirmed' })).toHaveLength(1)
    expect(agent.session.snapshotEvents().some(e => e.type === 'patent/fact-confirmed')).toBe(true)
  })

  it('claims and checks: the model generates plans, saves a version, and runs quality checks', async () => {
    const ctx = await harness(new MockAdapter([
      toolCallResponse('c1', 'generate_claims', {}),
      toolCallResponse('c2', 'save_claim_version', { kind: 'balanced' }),
      toolCallResponse('c3', 'run_quality_checks', {}),
      textResponse('done'),
    ]))
    const { a } = seedTwoPatents(ctx)
    const agent = await ctx.agentLoop.create(SessionId('it-claims'), { provider: 'mock', model: 'mock' })
    bind(ctx, agent, a, 'strict')
    // Two human-confirmed facts anchor an independent claim plus one dependent.
    const f1 = ctx.patentCore.createFactCandidate(agent.session, 'dynamic weight adjustment on device fault')
    const f2 = ctx.patentCore.createFactCandidate(agent.session, 'threshold triggers reweighting')
    ctx.patentCore.confirmFact(agent.session, f1.id, brandString<OperatorId>('USER-1'))
    ctx.patentCore.confirmFact(agent.session, f2.id, brandString<OperatorId>('USER-1'))

    await runOnce(ctx, agent, 'draft and check claims')
    const outcomes = toolOutcomes(agent.session.snapshotEvents())
    expect(outcomeAt(outcomes, 0).text).toContain('Generated 3 claim plans')
    expect(outcomeAt(outcomes, 1).isError).toBe(false)
    expect(outcomeAt(outcomes, 1).text.toLowerCase()).toContain('balanced')
    expect(outcomeAt(outcomes, 2).isError).toBe(false)
    expect(agent.session.snapshotEvents().some(e => e.type === 'patent/claim-version-saved')).toBe(true)
  })

  it('claim generation is deterministic and quality checks flag missing facts', async () => {
    const ctx = await harness(new MockAdapter([]))
    const { a } = seedTwoPatents(ctx)
    const agent = await ctx.agentLoop.create(SessionId('it-core-claims'), { provider: 'mock', model: 'mock' })
    bind(ctx, agent, a, 'suggest')

    // With no confirmed facts, checks report a critical fact-support finding.
    const before = ctx.patentCore.runChecks(agent.session)
    expect(before.some(risk => risk.level === 'critical' && risk.rule === 'fact-support')).toBe(true)

    const c1 = ctx.patentCore.createFactCandidate(agent.session, 'anchor feature')
    const c2 = ctx.patentCore.createFactCandidate(agent.session, 'refinement feature')
    ctx.patentCore.confirmFact(agent.session, c1.id, brandString<OperatorId>('USER-1'))
    ctx.patentCore.confirmFact(agent.session, c2.id, brandString<OperatorId>('USER-1'))
    const plans = ctx.patentCore.generateClaimCandidates(agent.session)
    expect(plans.broad.dependentClaims).toHaveLength(0)
    expect(plans.balanced.dependentClaims).toHaveLength(1)
    expect(plans.robust.dependentClaims).toHaveLength(1)
    expect(plans.balanced.independentClaim).toContain('anchor feature')
  })
})
