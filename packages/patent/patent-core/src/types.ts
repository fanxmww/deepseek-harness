/**
 * Pure types of the patent domain: branded ids, domain records, the
 * `ctx.patentCore` service face, and the ONE home of the patent
 * `SessionEventMap` declarations plus the `patentContext` projection key. Free
 * of this package's host-side value imports so client and aggregate programs
 * receive the declaration merges without pulling runtime code.
 *
 * @module @deepseek-ai/dsh-patent-core/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque id of a workspace (the largest tenancy boundary). */
export type WorkspaceId = Branded<'WorkspaceId'>
/** Opaque id of an R&D project holding one or more patent cases. */
export type ProjectId = Branded<'ProjectId'>
/** Opaque id of a single patent case. */
export type PatentId = Branded<'PatentId'>
/** Opaque id of an imported material document scoped to one patent. */
export type MaterialId = Branded<'MaterialId'>
/** Opaque id of a technical fact. */
export type FactId = Branded<'FactId'>
/** Opaque id of the human operator who confirms a fact. */
export type OperatorId = Branded<'OperatorId'>

/**
 * Generation mode governing which data an agent may read and where it may
 * write. `strict` refuses unconfirmed facts and formal drafting only; `suggest`
 * may propose candidate facts; `creative` explores alternatives in a sandbox.
 * The mode is enforced by the tool policy layer, not by prompt text alone.
 */
export type PatentMode = 'strict' | 'suggest' | 'creative'

/** An R&D project: the container for one or more patent cases. */
export interface Project {
  /** Stable project id. */
  readonly id: ProjectId
  /** Owning workspace. */
  readonly workspaceId: WorkspaceId
  /** Human-readable project name. */
  readonly name: string
}

/** A single patent case under a project. */
export interface PatentCase {
  /** Stable patent id. */
  readonly id: PatentId
  /** Owning project. */
  readonly projectId: ProjectId
  /** Working title. */
  readonly title: string
  /** Default generation mode when a session binds to this patent. */
  readonly defaultMode: PatentMode
}

/** An imported material document scoped to exactly one patent. */
export interface Material {
  /** Stable material id. */
  readonly id: MaterialId
  /** Owning patent; a material never crosses patent boundaries. */
  readonly patentId: PatentId
  /** Document title. */
  readonly title: string
  /** Extracted plain text used for searching and source location. */
  readonly text: string
}

/** Lifecycle of a technical fact. Only `confirmed` facts enter formal drafting. */
export type FactStatus = 'candidate' | 'confirmed' | 'rejected'

/** A technical fact: agent-extracted candidate or human-confirmed truth. */
export interface TechnicalFact {
  /** Stable fact id. */
  readonly id: FactId
  /** Owning patent. */
  readonly patentId: PatentId
  /** The fact statement. */
  readonly content: string
  /** Current lifecycle status. */
  readonly status: FactStatus
  /** The human operator who confirmed the fact, present only once confirmed. */
  readonly confirmedBy?: OperatorId
}

/**
 * The patent context a session is bound to. Host-injected and folded from the
 * `patent/context-bound` session event, so it is reconstructable from the log
 * and an agent cannot rewrite its own `patentId`.
 */
export interface PatentContext {
  /** Bound workspace. */
  readonly workspaceId: WorkspaceId
  /** Bound project. */
  readonly projectId: ProjectId
  /** Bound patent; every patent-scoped tool re-validates against it. */
  readonly patentId: PatentId
  /** Active generation mode for this session. */
  readonly mode: PatentMode
}

/** Input to create a project. */
export interface CreateProjectInput {
  /** Owning workspace. */
  readonly workspaceId: WorkspaceId
  /** Human-readable name. */
  readonly name: string
}

/** Input to create a patent case. */
export interface CreatePatentInput {
  /** Owning project. */
  readonly projectId: ProjectId
  /** Working title. */
  readonly title: string
  /** Default generation mode; falls back to `strict` when omitted. */
  readonly defaultMode?: PatentMode
}

/** Input to import a material document. */
export interface ImportMaterialInput {
  /** Owning patent. */
  readonly patentId: PatentId
  /** Document title. */
  readonly title: string
  /** Extracted plain text. */
  readonly text: string
}

/** Input to bind a session to a patent context. */
export interface BindContextInput {
  /** Bound workspace. */
  readonly workspaceId: WorkspaceId
  /** Bound project; must own the patent. */
  readonly projectId: ProjectId
  /** Bound patent. */
  readonly patentId: PatentId
  /** Generation mode; falls back to the patent's default mode when omitted. */
  readonly mode?: PatentMode
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The patent context this session is bound to from here on. Host-injected,
     * whole-value replace, last write wins. Log-only, never model history.
     * @param workspaceId - bound workspace id.
     * @param projectId - bound project id.
     * @param patentId - bound patent id.
     * @param mode - active generation mode.
     */
    'patent/context-bound': {
      workspaceId: string
      projectId: string
      patentId: string
      mode: PatentMode
    }
    /**
     * A human confirmed a candidate fact into the patent fact base. Durable
     * audit record; an agent cannot produce it without human approval.
     * @param factId - the confirmed fact id.
     * @param confirmedBy - the human operator id.
     */
    'patent/fact-confirmed': {
      factId: string
      confirmedBy: string
    }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    patentContext: PatentContext | null
  }
  interface SessionProjectionMap {
    /**
     * The current patent context bound to the session (latest
     * `patent/context-bound`), or `null` before any binding. Whole-value
     * last-wins fold.
     */
    patentContext: PatentContext | null
  }
}
