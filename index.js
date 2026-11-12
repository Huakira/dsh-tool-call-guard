/**
 * Tool-call guard — the supplemental half of loop protection.
 *
 * It complements, and deliberately does not duplicate, two other layers:
 * - the in-tree `repeat-tool-reminder`, which watches *consecutive identical*
 *   tool calls;
 * - `@argszero/cordis-plugin-thinking-loop-guard`, which watches the model's
 *   reasoning channel (reasoning-only steps, restated material, repetition).
 *
 * What is left over is the failure shape that actually burns steps in long
 * agentic sessions: a call is rejected by **argument validation** (e.g. GLM-5.3
 * Flash silently drops a required field in ~19% of bash calls once the context
 * is long), and the model responds by starting a *different* command instead
 * of repairing the call. One omission becomes N wasted steps.
 *
 * Three behaviours, each individually disableable:
 * 1. rejected-argument recovery — tells the model to re-issue the same call
 *    with every required field, and names the missing ones;
 * 2. repeated-failure escalation — after `repeatLimit` such rejections in one
 *    turn, tells the model to stop retrying and report status;
 * 3. per-turn step budget — after `stepsPerTurn` steps in one turn, a one-shot
 *    nudge to summarise progress (never a hard stop: long tasks are legitimate);
 * 4. fragile-model caution — on selecting a model in `fragileModels`, a
 *    one-per-session reminder about silently lost tool arguments.
 */

import Schema from '@deepseek-ai/schemastery'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

export const name = 'tool-call-guard'

/** The agents service is the only thing this plugin reads from the host. */
export const inject = ['agents']

const SOURCE = { kind: 'plugin:tool-call-guard', plugin: 'tool-call-guard' }

/** Argument-validation failures a harness or provider can return. */
const ARGUMENT_ERROR = /(?:invalid arguments|missing required (?:property|parameter|argument)|Invalid arguments|missing_required_parameter)/i

const MISSING_PROPERTY = /missing required (?:property|parameter|argument)[^"\w]*["']?([\w.]+)["']?/gi

function notice(text) {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { ...SOURCE, form: 'notice', summary: 'tool-call-guard' },
  })
}

/** Pull the missing property names out of a validation message. */
export function missingProperties(text) {
  const out = []
  for (const match of String(text).matchAll(MISSING_PROPERTY)) {
    const name = match[1]
    if (name && !out.includes(name)) out.push(name)
  }
  return out
}

/** Whether a tool result carries an argument-validation failure. */
export function isArgumentError(text) {
  return ARGUMENT_ERROR.test(String(text))
}

/** Flatten a tool result message to its text. */
function resultText(message) {
  const blocks = message?.content
  if (!Array.isArray(blocks)) return ''
  return blocks
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
}

/**
 * Read one config field. The loader hands `apply` either a plain resolved
 * object or a reactive one whose fields expose `get()`; support both.
 */
function field(config, key, fallback) {
  const raw = config?.[key]
  const value = typeof raw?.get === 'function' ? raw.get() : raw
  return value === undefined ? fallback : value
}

export function apply(ctx, config) {
  const repeatLimit = Number(field(config, 'repeatLimit', 3)) || 0
  const stepsPerTurn = Number(field(config, 'stepsPerTurn', 60)) || 0
  const warnOnModelSwitch = field(config, 'warnOnModelSwitch', true) !== false
  const fragileModels = (field(config, 'fragileModels', ['glm-5.3-flash']) ?? [])
    .map((name) => String(name).trim().toLowerCase())
    .filter(Boolean)

  /** Per-agent counters, dropped with the agent. */
  const state = new WeakMap()

  function stateFor(agent) {
    let current = state.get(agent)
    if (current === undefined) {
      current = { turn: -1, steps: 0, rejected: 0, stepNudged: false, cautioned: new Set() }
      state.set(agent, current)
    }
    return current
  }

  function steer(agent, text) {
    try {
      agent.steer(notice(text))
    } catch (error) {
      ctx.logger?.warn?.('tool-call-guard: steer failed: %o', error)
    }
  }

  function inject(agent, text) {
    try {
      agent.inject(notice(text))
    } catch (error) {
      ctx.logger?.warn?.('tool-call-guard: inject failed: %o', error)
    }
  }

  ctx.on('session/event', (session, event) => {
    const agent = ctx.agents.get(session.id)
    if (agent === undefined) return
    const current = stateFor(agent)

    if (event.type === 'turn/start') {
      current.turn = event.data?.turn ?? current.turn + 1
      current.steps = 0
      current.rejected = 0
      current.stepNudged = false
      return
    }

    if (event.type === 'step/start') {
      const turn = event.data?.turn
      if (turn !== undefined && turn !== current.turn) {
        current.turn = turn
        current.steps = 0
        current.rejected = 0
        current.stepNudged = false
      }
      current.steps += 1
      if (stepsPerTurn > 0 && !current.stepNudged && current.steps === stepsPerTurn) {
        current.stepNudged = true
        steer(
          agent,
          `This turn has used ${current.steps} steps. Pause and report: what is confirmed, what is still unknown, and whether the current approach is still working. `
            + 'If you are re-testing the same hypothesis, state what new evidence the last attempts produced; if there is none, change approach or ask the user.',
        )
      }
      return
    }

    if (event.type === 'tool/result') {
      const failure = event.data?.error
      const text = [resultText(event.data?.message), failure?.reason ?? '', failure?.message ?? ''].join('\n')
      if (!isArgumentError(text)) return
      current.rejected += 1
      const missing = missingProperties(text)
      const detail = missing.length > 0 ? ` Missing required field(s): ${missing.join(', ')}.` : ''
      if (repeatLimit > 0 && current.rejected >= repeatLimit) {
        steer(
          agent,
          `Tool calls have now been rejected ${current.rejected} times in this turn for argument problems.${detail} `
            + 'Stop retrying the same shape. Report to the user what you were trying to do, what the tool needs, and what you have already learned — then wait for direction instead of continuing.',
        )
        return
      }
      steer(
        agent,
        `The previous tool call was rejected by argument validation.${detail} `
          + 'Re-issue the SAME call with every required field filled in (do not switch to a different command), then continue from that result.',
      )
      return
    }

    if (event.type === 'model/selection' && warnOnModelSwitch) {
      const model = String(event.data?.model ?? '').toLowerCase()
      if (!model || !fragileModels.some((name) => model.includes(name))) return
      if (current.cautioned.has(model)) return
      current.cautioned.add(model)
      inject(
        agent,
        `Note on the selected model (${event.data?.model}): in long sessions it can silently drop required tool-call arguments. `
          + 'Keep individual commands small, quote paths carefully, and if a tool call is rejected for arguments, re-issue that same call complete rather than starting over. '
          + 'In long turns, checkpoint by reporting progress before continuing.',
      )
    }
  })
}

/** Config schema; every field is editable from the plugin settings page. */
export const Config = Schema.object({
  repeatLimit: Schema.number()
    .default(3)
    .description('Argument rejections in one turn before telling the model to stop and report (0 keeps the per-call repair hint but disables the stop-loss).'),
  stepsPerTurn: Schema.number()
    .default(60)
    .description('Steps in one turn before a one-shot progress nudge (0 disables). Never interrupts the turn.'),
  warnOnModelSwitch: Schema.boolean()
    .default(true)
    .description('Inject a one-per-session caution when a fragile model is selected.'),
  fragileModels: Schema.array(Schema.string())
    .default(['glm-5.3-flash'])
    .description('Model id fragments treated as fragile (substring match, case-insensitive).'),
})
