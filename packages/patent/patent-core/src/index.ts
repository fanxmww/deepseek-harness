/**
 * In-process patent business truth: projects, patent cases, materials, and
 * technical facts, plus the per-session patent context folded from the session
 * log. `ctx.patentCore` is the single owner of patent data; model-facing tools
 * call it and never touch storage directly, so isolation and audit are enforced
 * in one place.
 *
 * The PoC keeps records in memory; a production build backs them with the
 * per-project SQLite store described in the design document. The durable facts
 * that must survive a reload — the bound context and each human confirmation —
 * are appended as session events so they satisfy the model-visible-is-logged
 * rule and drive the `patentContext` projection.
 *
 * @module @deepseek-ai/dsh-patent-core
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {
  BindContextInput,
  CreatePatentInput,
  CreateProjectInput,
  FactId,
  FactStatus,
  ImportMaterialInput,
  Material,
  MaterialId,
  OperatorId,
  PatentCase,
  PatentContext,
  PatentId,
  PatentMode,
  Project,
  ProjectId,
  TechnicalFact,
  WorkspaceId,
} from './types.ts'

// The pure payload outlet (./types.ts, the ONE home of the patent session-event
// and projection-key declarations) re-exported onto the package root keeps the
// module edge in the emitted index.d.ts, so aggregate programs consuming the
// declarations still receive the SessionEventMap and SessionProjectionMap merges.
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    patentCore: PatentCore
  }
}

/** Machine-routable classification of a patent-domain rejection. */
export type PatentErrorCode =
  | 'PATENT_NOT_FOUND'
  | 'PROJECT_NOT_FOUND'
  | 'PATENT_PROJECT_MISMATCH'
  | 'FACT_NOT_FOUND'
  | 'CONTEXT_NOT_BOUND'
  | 'CROSS_PATENT_ACCESS'

/** Error thrown at the patent-domain boundary. */
export class PatentError extends Error {
  /** Stable machine-routable classification. */
  readonly code: PatentErrorCode
  /**
   * @param message - human-readable rejection reason.
   * @param code - stable classification.
   */
  constructor(message: string, code: PatentErrorCode) {
    super(message)
    this.name = 'PatentError'
    this.code = code
  }
}

const modeSchema: ZodType<PatentMode> = zod.union([
  zod.literal('strict'),
  zod.literal('suggest'),
  zod.literal('creative'),
])

/** Wire/state schema of the `patentContext` projection (bound context or null). */
const contextSchema = zod.union([
  zod.object({
    workspaceId: zod.string().min(1),
    projectId: zod.string().min(1),
    patentId: zod.string().min(1),
    mode: modeSchema,
  }),
  zod.null(),
]) as unknown as ZodType<PatentContext | null>

/** Read filter for {@link PatentCore.listFacts}. */
export interface ListFactsOptions {
  /** Restrict to one status; omit for every fact of the bound patent. */
  readonly status?: FactStatus
}

/**
 * Patent business-truth service (`ctx.patentCore`). Holds project, patent,
 * material, and fact records, and folds the per-session bound context from the
 * log. Every patent-scoped read or mutation resolves the caller's bound
 * context and rejects access outside it.
 */
export class PatentCore extends Service {
  static inject = ['sessionProjections']

  private readonly projects = new Map<string, Project>()
  private readonly patents = new Map<string, PatentCase>()
  private readonly materials = new Map<string, Material>()
  private readonly facts = new Map<string, TechnicalFact>()

  /**
   * @param ctx - registrant context carrying the session-projection registry.
   */
  constructor(ctx: Context) {
    super(ctx, 'patentCore')
    ctx.sessionProjections.register<'patentContext', PatentContext | null>({
      key: 'patentContext',
      stateSchema: contextSchema,
      init: () => null,
      apply: (state, event) => {
        if (event.type !== 'patent/context-bound') return state
        return {
          workspaceId: brandString<WorkspaceId>(event.data.workspaceId),
          projectId: brandString<ProjectId>(event.data.projectId),
          patentId: brandString<PatentId>(event.data.patentId),
          mode: event.data.mode,
        }
      },
      wire: { viewSchema: contextSchema, view: state => state },
      stateVersion: 1,
    })
  }

  /**
   * Create a project.
   * @param input - owning workspace and name.
   * @returns the created project.
   */
  createProject(input: CreateProjectInput): Project {
    const project: Project = {
      id: brandString<ProjectId>(`PRJ-${randomUUID()}`),
      workspaceId: input.workspaceId,
      name: input.name,
    }
    this.projects.set(project.id, project)
    return project
  }

  /**
   * Create a patent case under an existing project.
   * @param input - owning project, title, and optional default mode.
   * @returns the created patent case.
   * @throws {@link PatentError} `PROJECT_NOT_FOUND` when the project is unknown.
   */
  createPatentCase(input: CreatePatentInput): PatentCase {
    if (!this.projects.has(input.projectId)) {
      throw new PatentError(`project "${input.projectId}" not found`, 'PROJECT_NOT_FOUND')
    }
    const patent: PatentCase = {
      id: brandString<PatentId>(`PAT-${randomUUID()}`),
      projectId: input.projectId,
      title: input.title,
      defaultMode: input.defaultMode ?? 'strict',
    }
    this.patents.set(patent.id, patent)
    return patent
  }

  /**
   * Import a material document scoped to one patent.
   * @param input - owning patent, title, and extracted text.
   * @returns the stored material.
   * @throws {@link PatentError} `PATENT_NOT_FOUND` when the patent is unknown.
   */
  importMaterial(input: ImportMaterialInput): Material {
    if (!this.patents.has(input.patentId)) {
      throw new PatentError(`patent "${input.patentId}" not found`, 'PATENT_NOT_FOUND')
    }
    const material: Material = {
      id: brandString<MaterialId>(`MAT-${randomUUID()}`),
      patentId: input.patentId,
      title: input.title,
      text: input.text,
    }
    this.materials.set(material.id, material)
    return material
  }

  /**
   * Bind a session to a patent context by appending `patent/context-bound`. The
   * host calls this; the id it writes is authoritative and an agent cannot
   * change it later.
   * @param agent - the live agent whose session is bound.
   * @param input - workspace, project, patent, and optional mode.
   * @returns the resolved bound context.
   * @throws {@link PatentError} when the patent is unknown or not in the project.
   */
  bindContext(agent: Agent, input: BindContextInput): PatentContext {
    const patent = this.patents.get(input.patentId)
    if (patent === undefined) {
      throw new PatentError(`patent "${input.patentId}" not found`, 'PATENT_NOT_FOUND')
    }
    if (patent.projectId !== input.projectId) {
      throw new PatentError(
        `patent "${input.patentId}" belongs to project "${patent.projectId}", not "${input.projectId}"`,
        'PATENT_PROJECT_MISMATCH',
      )
    }
    const mode = input.mode ?? patent.defaultMode
    agent.session.append('patent/context-bound', {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      patentId: input.patentId,
      mode,
    })
    return {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      patentId: input.patentId,
      mode,
    }
  }

  /**
   * Read the patent context a session is currently bound to.
   * @param session - the session to inspect.
   * @returns the bound context, or `undefined` when none is bound.
   */
  contextOf(session: Session): PatentContext | undefined {
    const state = this.ctx.sessionProjections.stateOf(session, 'patentContext')
    return state ?? undefined
  }

  /**
   * Resolve the bound context or reject when the session has none.
   * @param session - the session to inspect.
   * @returns the bound context.
   * @throws {@link PatentError} `CONTEXT_NOT_BOUND` when no context is bound.
   */
  requireContext(session: Session): PatentContext {
    const context = this.contextOf(session)
    if (context === undefined) {
      throw new PatentError('session is not bound to a patent context', 'CONTEXT_NOT_BOUND')
    }
    return context
  }

  /**
   * Assert that a requested patent id, when present, equals the session's bound
   * patent. This is the execution-layer isolation check every patent-scoped
   * tool runs before touching data.
   * @param session - the calling session.
   * @param requestedPatentId - an explicit patent id from tool arguments.
   * @returns the bound context.
   * @throws {@link PatentError} `CROSS_PATENT_ACCESS` on a mismatch.
   */
  assertPatentScope(session: Session, requestedPatentId?: string): PatentContext {
    const context = this.requireContext(session)
    if (requestedPatentId !== undefined && requestedPatentId !== context.patentId) {
      throw new PatentError(
        `cross-patent access denied: session is bound to "${context.patentId}", not "${requestedPatentId}"`,
        'CROSS_PATENT_ACCESS',
      )
    }
    return context
  }

  /**
   * Search materials of the session's bound patent only.
   * @param session - the calling session.
   * @param query - optional case-insensitive substring over title and text.
   * @returns matching materials scoped to the bound patent.
   */
  searchMaterials(session: Session, query?: string): Material[] {
    const context = this.requireContext(session)
    const term = query?.trim().toLowerCase()
    const results: Material[] = []
    for (const material of this.materials.values()) {
      if (material.patentId !== context.patentId) continue
      if (term !== undefined && term.length > 0
        && !material.title.toLowerCase().includes(term)
        && !material.text.toLowerCase().includes(term)) continue
      results.push(material)
    }
    return results
  }

  /**
   * Create a candidate fact for the bound patent. Agents create only
   * candidates; confirmation is a separate human-approved step.
   * @param session - the calling session.
   * @param content - the fact statement.
   * @returns the stored candidate fact.
   */
  createFactCandidate(session: Session, content: string): TechnicalFact {
    const context = this.requireContext(session)
    const fact: TechnicalFact = {
      id: brandString<FactId>(`FACT-${randomUUID()}`),
      patentId: context.patentId,
      content,
      status: 'candidate',
    }
    this.facts.set(fact.id, fact)
    return fact
  }

  /**
   * List facts of the bound patent, optionally filtered by status.
   * @param session - the calling session.
   * @param options - optional status filter.
   * @returns the matching facts scoped to the bound patent.
   */
  listFacts(session: Session, options: ListFactsOptions = {}): TechnicalFact[] {
    const context = this.requireContext(session)
    const results: TechnicalFact[] = []
    for (const fact of this.facts.values()) {
      if (fact.patentId !== context.patentId) continue
      if (options.status !== undefined && fact.status !== options.status) continue
      results.push(fact)
    }
    return results
  }

  /**
   * Confirm a candidate fact into the fact base after human approval, appending
   * `patent/fact-confirmed` as the durable audit record.
   * @param session - the calling session.
   * @param factId - the candidate fact id.
   * @param confirmedBy - the human operator id.
   * @returns the confirmed fact.
   * @throws {@link PatentError} when the fact is unknown or outside the bound patent.
   */
  confirmFact(session: Session, factId: string, confirmedBy: OperatorId): TechnicalFact {
    const context = this.requireContext(session)
    const fact = this.facts.get(factId)
    if (fact === undefined) {
      throw new PatentError(`fact "${factId}" not found`, 'FACT_NOT_FOUND')
    }
    if (fact.patentId !== context.patentId) {
      throw new PatentError(
        `cross-patent access denied: fact "${factId}" belongs to "${fact.patentId}"`,
        'CROSS_PATENT_ACCESS',
      )
    }
    const confirmed: TechnicalFact = { ...fact, status: 'confirmed', confirmedBy }
    this.facts.set(confirmed.id, confirmed)
    session.append('patent/fact-confirmed', { factId, confirmedBy })
    return confirmed
  }
}

export default PatentCore
