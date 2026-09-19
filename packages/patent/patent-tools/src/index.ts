/**
 * Model-facing patent tools plus the mode-policy and isolation enforcement
 * around them. Every tool calls `ctx.patentCore` and never touches storage
 * directly. A `tools/pre-execute` listener enforces the generation mode and
 * routes fact confirmation through human approval, while each tool re-validates
 * the bound patent scope inside `execute` so a denial cannot be bypassed by a
 * caller that skips the policy layer.
 *
 * @module @deepseek-ai/dsh-patent-tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ClaimPlan, OperatorId } from '@deepseek-ai/dsh-patent-core'
import type {} from '@deepseek-ai/dsh-patent-core'

/** Mutable, plain-string projection of a {@link ClaimPlan} for the tool result. */
interface WireClaimPlan {
  kind: string
  independentClaim: string
  dependentClaims: string[]
  usedFactIds: string[]
}

export const name = 'patent-tools'
export const inject = ['tools', 'patentCore']

/** Names of the patent tools whose calls the mode policy governs. */
const PATENT_TOOL_NAMES = new Set([
  'search_materials',
  'create_fact_candidate',
  'confirm_fact',
  'list_confirmed_facts',
  'build_feature',
  'generate_claims',
  'save_claim_version',
  'run_quality_checks',
])

/** The claim plan layers a model may request when saving a version. */
const CLAIM_PLAN_KINDS = ['broad', 'balanced', 'robust'] as const

/**
 * The mode/approval decision for one patent tool call, given the caller's bound
 * generation mode. Kept pure so the same rule is testable in isolation.
 * @param toolName - the patent tool being called.
 * @param mode - the caller's bound generation mode, or undefined when unbound.
 * @returns the pre-execute decision, or `undefined` to defer to the next listener.
 */
function modeDecision(toolName: string, mode: string | undefined): PreToolDecision | undefined {
  if (toolName === 'confirm_fact') {
    return { kind: 'ask', reason: 'Confirming a fact into the patent fact base requires human approval.' }
  }
  if (toolName === 'create_fact_candidate' && mode === 'strict') {
    return {
      kind: 'deny',
      reason: 'strict mode forbids introducing unconfirmed facts; switch to suggest mode to add candidates.',
    }
  }
  return undefined
}

/**
 * Register the patent tools and their mode/approval policy.
 * @param ctx - registrant context carrying the tool registry and patent core.
 */
export function apply(ctx: Context): void {
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    if (!PATENT_TOOL_NAMES.has(exec.name)) return next()
    const agent = exec.agent
    if (agent === undefined) return next()
    const context = ctx.patentCore.contextOf(agent.session)
    const decision = modeDecision(exec.name, context?.mode)
    return decision ?? next()
  })

  ctx.tools.register(defineTool({
    name: 'search_materials',
    description: 'Search the imported materials of the current patent. Only the bound patent is searched.',
    parameters: {
      query: { type: 'string', description: 'Case-insensitive substring over material title and text.' },
      patentId: { type: 'string', description: 'Optional explicit patent id; must equal the bound patent.' },
    },
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true },
            title: { type: 'string', required: true },
            snippet: { type: 'string', required: true },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.length === 0 ? 'No materials matched.' : `${value.length} material(s) matched.`,
      }],
    },
    execute(args, exec) {
      const session = requireSession(exec.agent)
      ctx.patentCore.assertPatentScope(session, args.patentId)
      const materials = ctx.patentCore.searchMaterials(session, args.query)
      return Promise.resolve(materials.map(material => ({
        id: material.id,
        title: material.title,
        snippet: material.text.slice(0, 160),
      })))
    },
    presentCall: args => ({ card: 'generic', title: 'Search materials', kind: 'search', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'create_fact_candidate',
    description: 'Record a candidate technical fact for the current patent. Candidates require human confirmation.',
    parameters: {
      content: { type: 'string', required: true, description: 'The candidate fact statement.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          status: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Recorded candidate fact ${value.id} (${value.status}).` }],
    },
    execute(args, exec) {
      const session = requireSession(exec.agent)
      const content = args.content.trim()
      if (content.length === 0) throw new Error('create_fact_candidate requires non-empty content')
      const fact = ctx.patentCore.createFactCandidate(session, content)
      return Promise.resolve({ id: fact.id, status: fact.status })
    },
    presentCall: args => ({ card: 'generic', title: 'Record candidate fact', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'confirm_fact',
    description: 'Confirm a candidate fact into the patent fact base. Requires human approval; an agent cannot self-confirm.',
    parameters: {
      factId: { type: 'string', required: true, description: 'The candidate fact id.' },
      operator: { type: 'string', required: true, description: 'The confirming human operator id.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          status: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Fact ${value.id} is now ${value.status}.` }],
    },
    execute(args, exec) {
      const session = requireSession(exec.agent)
      const fact = ctx.patentCore.confirmFact(session, args.factId, brandString<OperatorId>(args.operator))
      return Promise.resolve({ id: fact.id, status: fact.status })
    },
    presentCall: args => ({ card: 'generic', title: 'Confirm fact', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'list_confirmed_facts',
    description: 'List the confirmed technical facts of the current patent.',
    parameters: {},
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true },
            content: { type: 'string', required: true },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `${value.length} confirmed fact(s).` }],
    },
    execute(_args, exec) {
      const session = requireSession(exec.agent)
      const facts = ctx.patentCore.listFacts(session, { status: 'confirmed' })
      return Promise.resolve(facts.map(fact => ({ id: fact.id, content: fact.content })))
    },
    presentCall: () => ({ card: 'generic', title: 'List confirmed facts', kind: 'other' }),
  }))

  ctx.tools.register(defineTool({
    name: 'build_feature',
    description: 'Add a technical feature for the current patent, optionally nested under a parent feature.',
    parameters: {
      content: { type: 'string', required: true, description: 'The feature expression.' },
      parentId: { type: 'string', description: 'Optional parent feature id in the same patent.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { id: { type: 'string', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: `Added feature ${value.id}.` }],
    },
    execute(args, exec) {
      const session = requireSession(exec.agent)
      const content = args.content.trim()
      if (content.length === 0) throw new Error('build_feature requires non-empty content')
      const feature = ctx.patentCore.createFeature(session, content, args.parentId)
      return Promise.resolve({ id: feature.id })
    },
    presentCall: args => ({ card: 'generic', title: 'Add feature', kind: 'other', rawInput: args }),
  }))

  const planSchema = {
    type: 'object',
    required: true,
    additionalProperties: false,
    properties: {
      kind: { type: 'string', required: true },
      independentClaim: { type: 'string', required: true },
      dependentClaims: { type: 'array', required: true, items: { type: 'string' } },
      usedFactIds: { type: 'array', required: true, items: { type: 'string' } },
    },
  } as const

  ctx.tools.register(defineTool({
    name: 'generate_claims',
    description: 'Generate broad, balanced, and robust claim plans from the current patent\'s confirmed facts.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { broad: planSchema, balanced: planSchema, robust: planSchema },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Generated 3 claim plans (broad: ${value.broad.dependentClaims.length} dep., `
          + `balanced: ${value.balanced.dependentClaims.length} dep., `
          + `robust: ${value.robust.dependentClaims.length} dep.).`,
      }],
    },
    execute(_args, exec) {
      const session = requireSession(exec.agent)
      const plans = ctx.patentCore.generateClaimCandidates(session)
      const toWire = (plan: ClaimPlan): WireClaimPlan => ({
        kind: plan.kind,
        independentClaim: plan.independentClaim,
        dependentClaims: [...plan.dependentClaims],
        usedFactIds: [...plan.usedFactIds],
      })
      return Promise.resolve({
        broad: toWire(plans.broad),
        balanced: toWire(plans.balanced),
        robust: toWire(plans.robust),
      })
    },
    presentCall: () => ({ card: 'generic', title: 'Generate claim plans', kind: 'other' }),
  }))

  ctx.tools.register(defineTool({
    name: 'save_claim_version',
    description: 'Save one generated claim plan (broad, balanced, or robust) as an immutable claim version.',
    parameters: {
      kind: { type: 'string', required: true, enum: [...CLAIM_PLAN_KINDS], description: 'Which plan layer to save.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          kind: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Saved ${value.kind} claim version ${value.id}.` }],
    },
    execute(args, exec) {
      const session = requireSession(exec.agent)
      const plans = ctx.patentCore.generateClaimCandidates(session)
      const version = ctx.patentCore.saveClaimVersion(session, plans[args.kind])
      return Promise.resolve({ id: version.id, kind: version.plan.kind })
    },
    presentCall: args => ({ card: 'generic', title: 'Save claim version', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'run_quality_checks',
    description: 'Run the basic quality checks over the current patent and return the risk findings.',
    parameters: {},
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            level: { type: 'string', required: true },
            rule: { type: 'string', required: true },
            message: { type: 'string', required: true },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.length === 0 ? 'No risks found.' : `${value.length} risk finding(s).`,
      }],
    },
    execute(_args, exec) {
      const session = requireSession(exec.agent)
      const risks = ctx.patentCore.runChecks(session)
      return Promise.resolve(risks.map(risk => ({ level: risk.level, rule: risk.rule, message: risk.message })))
    },
    presentCall: () => ({ card: 'generic', title: 'Run quality checks', kind: 'other' }),
  }))
}

/**
 * Resolve the owning session of a patent tool call, rejecting a non-agent caller.
 * @param agent - the calling agent, if any.
 * @returns the owning session.
 */
function requireSession(agent: Agent | undefined): Agent['session'] {
  if (agent === undefined) throw new Error('patent tools require an owning agent session')
  return agent.session
}
