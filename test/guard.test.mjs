import assert from 'node:assert/strict'
import { apply, isArgumentError, missingProperties } from '../index.js'

const CONFIG = {
  repeatLimit: 3,
  stepsPerTurn: 5,
  warnOnModelSwitch: true,
  fragileModels: ['glm-5.3-flash'],
}

function harness(config = CONFIG) {
  const steers = []
  const injects = []
  const handlers = {}
  const agent = {
    steer: (msg) => steers.push(msg.content[0].text),
    inject: (msg) => injects.push(msg.content[0].text),
  }
  const ctx = {
    on: (name, fn) => { handlers[name] = fn },
    agents: { get: () => agent },
    logger: { warn() {} },
  }
  apply(ctx, config)
  const session = { id: 's1' }
  return { handlers, session, steers, injects, emit: (event) => handlers['session/event'](session, event) }
}

const rejection = {
  type: 'tool/result',
  data: { message: { content: [{ type: 'text', text: 'Error: invalid arguments: missing required property "description"' }] } },
}

// 1. helpers
assert.equal(isArgumentError('Error: invalid arguments: missing required property "description"'), true)
assert.equal(isArgumentError('all tests passed'), false)
assert.deepEqual(missingProperties('missing required property "description"'), ['description'])

// 2. first rejection asks for a repair and names the field
{
  const h = harness()
  h.emit({ type: 'turn/start', data: { turn: 1 } })
  h.emit(rejection)
  assert.equal(h.steers.length, 1)
  assert.match(h.steers[0], /description/)
  assert.match(h.steers[0], /SAME call/i)
}

// 3. stop-loss after repeatLimit rejections
{
  const h = harness()
  h.emit({ type: 'turn/start', data: { turn: 1 } })
  h.emit(rejection); h.emit(rejection); h.emit(rejection)
  assert.equal(h.steers.length, 3)
  assert.match(h.steers[2], /rejected 3 times/)
  assert.match(h.steers[2], /Report to the user/)
}

// 4. counters reset on a new turn
{
  const h = harness()
  h.emit({ type: 'turn/start', data: { turn: 1 } })
  h.emit(rejection)
  h.emit({ type: 'turn/start', data: { turn: 2 } })
  h.emit(rejection)
  assert.match(h.steers[1], /SAME call/i, 'second turn starts from the repair hint again')
}

// 5. step budget fires once, never aborts
{
  const h = harness()
  h.emit({ type: 'turn/start', data: { turn: 1 } })
  for (let i = 1; i <= 7; i += 1) h.emit({ type: 'step/start', data: { turn: 1, step: i } })
  assert.equal(h.steers.length, 1)
  assert.match(h.steers[0], /5 steps/)
  assert.equal(h.injects.length, 0)
}

// 6. fragile-model caution is once per session and only for matching models
{
  const h = harness()
  h.emit({ type: 'model/selection', data: { model: 'glm-5.3-flash' } })
  h.emit({ type: 'model/selection', data: { model: 'glm-5.3-flash' } })
  h.emit({ type: 'model/selection', data: { model: 'claude-sonnet-5-5' } })
  assert.equal(h.injects.length, 1)
  assert.match(h.injects[0], /glm-5\.3-flash/)
}

// 7. every rule can be disabled
{
  const h = harness({ repeatLimit: 0, stepsPerTurn: 0, warnOnModelSwitch: false, fragileModels: [] })
  h.emit({ type: 'turn/start', data: { turn: 1 } })
  for (let i = 0; i < 10; i += 1) { h.emit(rejection); h.emit({ type: 'step/start', data: { turn: 1, step: i } }) }
  h.emit({ type: 'model/selection', data: { model: 'glm-5.3-flash' } })
  // repeatLimit 0 disables only the stop-loss; the repair hint still fires.
  assert.equal(h.steers.length, 10)
  assert.ok(h.steers.every((text) => /SAME call/i.test(text)))
  assert.equal(h.injects.length, 0)
}

console.log('all guard tests passed')
