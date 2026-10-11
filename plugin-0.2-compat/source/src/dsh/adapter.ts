import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection, type Agent, type AgentOptions, type ModelSelection, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type { SessionHandle } from '@deepseek-ai/dsh-session-persistence'
import { foldSessionTitle } from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-workspace'
import type {
  AgentAdapter,
  CreateSessionInput,
  SessionDetail,
  SessionSummary,
  AdapterWorkspaceRef,
} from '@beforewave/agent-helm'
import { lastAssistantText, lastEventTime, summarizeMessages } from './session-view.js'

export interface DshAdapterConfig {
  id?: string
  provider?: string
  model?: string
}

type Loaded = { agent?: Agent; events: readonly SessionEvent[]; header: unknown }

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

async function waitWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted()
  if (!signal) return await promise
  return await new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => { cleanup(); reject(signal.reason instanceof Error ? signal.reason : new Error('request cancelled')) }
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) return onAbort()
    promise.then((value) => { cleanup(); resolve(value) }, (error) => { cleanup(); reject(error) })
  })
}

export class DshAdapter implements AgentAdapter {
  readonly id: string
  readonly displayName = 'DeepSeek Harness'
  readonly capabilities = {
    persistentSession: true,
    nativeUi: true,
    history: true,
    cancel: true,
    steer: true,
    approval: false,
  } as const

  readonly #owned = new Map<string, { agent: Agent; dispose(): Promise<void> }>()

  constructor(readonly ctx: Context, readonly config: DshAdapterConfig = {}) {
    this.id = config.id?.trim() || 'dsh'
  }

  #agentOptions(): AgentOptions {
    if (this.config.provider && this.config.model) return { provider: this.config.provider, model: this.config.model }
    const defaults = this.ctx.get('agentDefaultModel')
    if (defaults !== undefined) {
      const selection = defaults.currentSelection()
      return { provider: selection.provider, model: selection.model }
    }
    throw new Error('DSH agentDefaultModel is unavailable; configure provider/model explicitly')
  }

  #installSelection(agentCtx: Context, agent: Agent): void {
    const defaults = this.ctx.get('agentDefaultModel')
    const configured = this.config.provider && this.config.model
      ? { provider: this.config.provider, model: this.config.model }
      : undefined
    let picked: ModelSelection | undefined
    const selection: ModelSelectionRef = {
      get current() {
        if (picked) return picked
        const logged = agent.session.requestHeader()?.config
        if (logged) return {
          provider: logged.provider,
          model: logged.model,
          ...(logged.reasoningEffort !== undefined ? { reasoningEffort: logged.reasoningEffort } : {}),
        }
        if (configured) return configured
        if (defaults) return defaults.currentSelection()
        throw new Error('no model selection available for DSH session')
      },
      set current(next) { picked = next },
      assembled: undefined,
    }
    installModelSelection(agentCtx, selection)
  }

  /**
   * DSH 0.2.x removed `dsh-agent-presets` (the per-session mount API):
   * declarative presets are now activated eagerly by the host registry and
   * linked to each agent scope before resume, and the chosen preset id lives on
   * the persisted session header (`header.agentPreset`). Only the
   * model-selection half of the old composition remains here -- exactly the
   * fallback 0.1.x already took when `agentPresets` was unavailable.
   */
  #composeSetup(): { setup: (agentCtx: Context, agent: Agent) => void } {
    return { setup: (agentCtx, agent) => this.#installSelection(agentCtx, agent) }
  }

  async #load(sessionId: string, signal?: AbortSignal): Promise<Loaded> {
    const live = this.ctx.agents.get(SessionId(sessionId))
    if (live) return { agent: live, events: live.session.snapshotEvents(), header: live.session.header }
    const persistence = this.ctx.get('sessionPersistence')
    if (!persistence) throw new Error(`session ${sessionId} is not live and session persistence is unavailable`)
    let handle: SessionHandle
    try {
      // 0.2.x persistence exposes per-session handles instead of `inspect()`.
      handle = await waitWithSignal(persistence.open(SessionId(sessionId), 'read'), signal)
    } catch (error) {
      if (signal?.aborted) throw error
      throw new Error(`DSH session not found: ${sessionId}`)
    }
    try {
      const read = await waitWithSignal(handle.read(), signal)
      return { events: read.events, header: handle.header }
    } finally {
      await handle.close().catch(() => {})
    }
  }

  async #ensureAgent(sessionId: string, signal?: AbortSignal): Promise<Agent> {
    const live = this.ctx.agents.get(SessionId(sessionId))
    if (live) return live
    const persistence = this.ctx.get('sessionPersistence')
    if (!persistence) throw new Error(`cannot resume ${sessionId}: session persistence unavailable`)
    const snapshot = await waitWithSignal(persistence.stat(SessionId(sessionId)), signal)
    if (!snapshot) throw new Error(`DSH session not found: ${sessionId}`)
    const composition = this.#composeSetup()
    const handle = await this.ctx.agents.resume({
      resumeSessionId: SessionId(sessionId),
      agentOptions: this.#agentOptions(),
      setup: composition.setup,
    })
    if (signal?.aborted) {
      await handle.dispose().catch(() => {})
      signal.throwIfAborted()
    }
    this.#owned.set(sessionId, handle)
    return handle.agent
  }

  async health(signal?: AbortSignal): Promise<Record<string, unknown>> {
    signal?.throwIfAborted()
    let persisted = -1
    try {
      const listing = this.ctx.get('sessionPersistence')?.list()
      persisted = listing ? (await waitWithSignal(listing, signal)).length : 0
    } catch (error) { if (signal?.aborted) throw error }
    const live = this.ctx.agents.list()
    return {
      status: 'ok',
      liveSessions: live.length,
      activeSessions: live.filter((a) => a.status === 'running').length,
      persistedSessions: persisted,
      workspaceRegistry: this.ctx.get('workspaceRegistry') !== undefined,
      nativeUi: true,
    }
  }

  async listWorkspaces(signal?: AbortSignal): Promise<AdapterWorkspaceRef[]> {
    signal?.throwIfAborted()
    const registry = this.ctx.get('workspaceRegistry')
    if (!registry) return []
    return registry.list().map((w) => ({
      id: w.id,
      path: w.path,
      ...(w.title ? { title: w.title } : {}),
      sessionCount: w.sessionIds.length,
    }))
  }

  async #resolveWorkspaceForCreate(ref: string, signal?: AbortSignal) {
    signal?.throwIfAborted()
    const registry = this.ctx.get('workspaceRegistry')
    if (!registry) {
      if (!isAbsolute(ref)) throw new Error(`workspace is not registered in DSH: ${ref}`)
      const path = await waitWithSignal(realpath(ref), signal)
      return { path, async attachSession() {} }
    }
    const existingByIdentity = registry.list().find((workspace) => workspace.id === ref || workspace.title === ref)
    if (existingByIdentity) return existingByIdentity
    if (!isAbsolute(ref)) throw new Error(`workspace is not registered in DSH: ${ref}`)
    const existingByPath = await waitWithSignal(registry.resolveByPath(ref), signal)
    if (existingByPath) return existingByPath
    signal?.throwIfAborted()
    const created = await registry.create(ref)
    signal?.throwIfAborted()
    return created
  }

  async createSession(input: CreateSessionInput, signal?: AbortSignal): Promise<SessionDetail> {
    const workspace = await this.#resolveWorkspaceForCreate(input.workspace, signal)
    const sessionId = `session-${randomUUID()}`
    const composition = this.#composeSetup()
    const handle = await this.ctx.agents.create({
      sessionId: SessionId(sessionId),
      agentOptions: this.#agentOptions(),
      meta: { cwd: workspace.path },
      setup: composition.setup,
    })
    if (signal?.aborted) {
      await handle.dispose().catch(() => {})
      signal.throwIfAborted()
    }
    this.#owned.set(sessionId, handle)
    try {
      await waitWithSignal(handle.agent.whenIdle(), signal)
      signal?.throwIfAborted()
      if (input.title) this.ctx.get('sessionTitle')?.rename(handle.agent.session, input.title)
      signal?.throwIfAborted()
      if (input.initialMessage?.trim()) {
        handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: input.initialMessage }], source: { kind: 'user' } }))
      }
      const detail = await this.getSession(sessionId, 20, signal)
      signal?.throwIfAborted()
      await workspace.attachSession(SessionId(sessionId))
      return detail
    } catch (error) {
      this.#owned.delete(sessionId)
      await handle.dispose().catch(() => {})
      throw error
    }
  }

  async listSessions(limit = 50, signal?: AbortSignal): Promise<SessionSummary[]> {
    signal?.throwIfAborted()
    const live = new Map(this.ctx.agents.list().map((a) => [String(a.id), a]))
    const rows = new Map<string, SessionSummary>()
    const persistence = this.ctx.get('sessionPersistence')

    if (persistence) {
      const snapshots = await waitWithSignal(persistence.list(), signal)
      const ordered = [...snapshots].sort((a, b) => {
        const at = Number(record(record(a).header).createdAt) || 0
        const bt = Number(record(record(b).header).createdAt) || 0
        return bt - at
      })
      for (const snapshot of ordered) {
        const h = record(record(snapshot).header)
        const id = String(h.id ?? h.sessionId ?? '')
        if (!id) continue
        const agent = live.get(id)
        const workspace = typeof h.cwd === 'string' ? h.cwd : undefined
        const updatedAt = typeof h.createdAt === 'number' ? new Date(h.createdAt).toISOString() : undefined
        rows.set(id, {
          id,
          agent: this.id,
          status: agent ? (agent.status === 'running' ? 'running' : 'idle') : 'idle',
          ...(workspace ? { workspace } : {}),
          ...(updatedAt ? { updatedAt } : {}),
          native: { live: Boolean(agent) },
        })
      }
    }

    // A just-created native session may not have reached persistence.list() yet.
    for (const agent of live.values()) {
      const id = String(agent.id)
      if (rows.has(id)) continue
      const updatedAt = lastEventTime(agent.session.snapshotEvents())
      const header = record(agent.session.header)
      const workspace = typeof header.cwd === 'string' ? header.cwd : undefined
      rows.set(id, {
        id,
        agent: this.id,
        status: agent.status === 'running' ? 'running' : 'idle',
        ...(workspace ? { workspace } : {}),
        ...(updatedAt ? { updatedAt } : {}),
        native: { live: true },
      })
    }

    signal?.throwIfAborted()
    return [...rows.values()]
      .sort((a, b) => Date.parse(b.updatedAt ?? '') - Date.parse(a.updatedAt ?? ''))
      .slice(0, limit)
  }

  async getSession(sessionId: string, maxMessages = 20, signal?: AbortSignal): Promise<SessionDetail> {
    const loaded = await this.#load(sessionId, signal)
    const messages = summarizeMessages(loaded.events, maxMessages)
    const h = record(loaded.header)
    const meta = record(h.meta)
    const title = foldSessionTitle(loaded.events)?.title
    const workspace = typeof h.cwd === 'string' ? h.cwd : typeof meta.cwd === 'string' ? meta.cwd : undefined
    const updatedAt = lastEventTime(loaded.events)
    const assistantText = lastAssistantText(loaded.events)
    return {
      id: sessionId,
      agent: this.id,
      status: loaded.agent ? (loaded.agent.status === 'running' ? 'running' : 'idle') : 'idle',
      ...(workspace ? { workspace } : {}),
      ...(title ? { title } : {}),
      ...(updatedAt ? { updatedAt } : {}),
      messages,
      ...(assistantText ? { lastAssistantText: assistantText } : {}),
      native: { live: Boolean(loaded.agent), sessionId },
    }
  }

  async resumeSession(sessionId: string, signal?: AbortSignal): Promise<SessionDetail> {
    await this.#ensureAgent(sessionId, signal)
    return await this.getSession(sessionId, 20, signal)
  }

  async prompt(sessionId: string, message: string, signal?: AbortSignal): Promise<{ accepted: true; sessionId: string }> {
    if (!message.trim()) throw new Error('message must not be empty')
    const agent = await this.#ensureAgent(sessionId, signal)
    signal?.throwIfAborted()
    agent.followup(createUserMessage({ content: [{ type: 'text', text: message }], source: { kind: 'user' } }))
    return { accepted: true, sessionId }
  }

  async disposeOwned(): Promise<void> {
    const handles = [...this.#owned.values()]
    this.#owned.clear()
    await Promise.allSettled(handles.map((handle) => handle.dispose()))
  }

  async cancel(sessionId: string, signal?: AbortSignal): Promise<{ cancelled: true; sessionId: string }> {
    signal?.throwIfAborted()
    const agent = this.ctx.agents.get(SessionId(sessionId))
    if (!agent) throw new Error(`session is not live: ${sessionId}`)
    agent.cancel({ kind: 'user' })
    return { cancelled: true, sessionId }
  }
}
