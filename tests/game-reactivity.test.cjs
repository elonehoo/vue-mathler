// Executes the real compiled Game and Keyboard using one Vue runtime.
// This in-memory renderer verifies reactivity, not browser layout or CSS animation.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { createRequire } = require('node:module')
const { test, before } = require('node:test')

const root = path.resolve(process.env.GAME_TEST_ROOT || path.join(__dirname, '..'))
const localRequire = createRequire(path.join(root, 'package.json'))
let runtime

before(async () => {
  // Use the repository's actual Vite configuration and plugin-vue compilation.
  // Only the entry/output change: bundle Game and its renderer together instead
  // of mounting the browser entry, then execute that bundle in a custom host.
  const { build } = await import(pathToFileURL(localRequire.resolve('vite')).href)
  const entry = path.join(root, '__game-reactivity-test-entry__.ts')
  const result = await build({
    root,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: { entry, formats: ['es'] }
    },
    plugins: [{
      name: 'game-runtime-test-entry',
      resolveId(id) { if (id === entry) return entry },
      load(id) {
        if (id === entry) return 'export { default as Game } from "./src/Game.vue"; export { createRenderer, nextTick } from "vue";'
      }
    }]
  })
  const outputs = (Array.isArray(result) ? result : [result]).flatMap(item => item.output)
  const chunks = outputs.filter(item => item.type === 'chunk')
  assert.equal(chunks.length, 1, 'one self-contained runtime bundle')
  assert.deepEqual(chunks[0].imports, [], 'no second Vue runtime or external imports')
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mathler-runtime-test-'))
  try {
    const filename = path.join(directory, 'game.mjs')
    await fs.writeFile(filename, chunks[0].code)
    runtime = await import(pathToFileURL(filename).href)
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

function node(type, text = '') {
  const classes = new Set()
  return {
    type, text, children: [], parent: null, props: {},
    classList: {
      add: (...values) => values.forEach(value => classes.add(value)),
      remove: (...values) => values.forEach(value => classes.delete(value))
    },
    addEventListener() {},
    removeEventListener() {}
  }
}

function descendants(parent) {
  return parent.children.flatMap(child => [child, ...descendants(child)])
}

function content(element) {
  return element.text + element.children.map(content).join('')
}

function hasClass(element, name) {
  return String(element.props.class || '').split(/\s+/).includes(name)
}

function mount(t) {
  const original = new Map()
  const replace = (name, value) => {
    original.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  }
  let now = 0
  let id = 0
  const timers = new Map()
  const listeners = new Set()
  const added = []
  const removed = []
  const errors = []
  const warnings = []
  const timer = (fn, delay = 0) => {
    const key = ++id
    timers.set(key, { due: now + Number(delay), fn })
    return key
  }
  replace('setTimeout', timer)
  replace('clearTimeout', key => timers.delete(key))
  replace('requestAnimationFrame', fn => timer(fn, 0))
  replace('location', { search: `?${Buffer.from('0+22+1').toString('base64')}` })
  replace('document', { body: { offsetHeight: 0 } })
  replace('window', {
    addEventListener(type, fn) {
      assert.equal(type, 'keyup')
      listeners.add(fn)
      added.push(fn)
    },
    removeEventListener(type, fn) {
      assert.equal(type, 'keyup')
      listeners.delete(fn)
      removed.push(fn)
    },
    getComputedStyle: () => ({
      transitionDelay: '0s', transitionDuration: '0s',
      animationDelay: '0s', animationDuration: '0s'
    })
  })
  const host = node('root')
  const remove = child => {
    if (child.parent) {
      const index = child.parent.children.indexOf(child)
      if (index !== -1) child.parent.children.splice(index, 1)
      child.parent = null
    }
  }
  const insert = (child, parent, anchor = null) => {
    remove(child)
    const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, child)
    child.parent = parent
  }
  const renderer = runtime.createRenderer({
    insert, remove,
    createElement: type => node(type),
    createText: text => node('#text', text),
    createComment: text => node('#comment', text),
    setText: (element, text) => { element.text = text },
    setElementText: (element, text) => {
      element.children.forEach(child => { child.parent = null })
      element.children = []
      element.text = text
    },
    parentNode: element => element.parent,
    nextSibling: element => element.parent?.children[element.parent.children.indexOf(element) + 1] || null,
    patchProp: (element, key, oldValue, value) => { element.props[key] = value },
    setScopeId() {},
    insertStaticContent(html, parent, anchor) {
      const element = node('#static', html)
      insert(element, parent, anchor)
      return [element, element]
    }
  })
  const app = renderer.createApp(runtime.Game)
  app.config.errorHandler = error => errors.push(error)
  app.config.warnHandler = message => warnings.push(message)
  let mounted = false
  t.after(() => {
    if (mounted) app.unmount()
    for (const [name, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
    assert.deepEqual(errors, [], 'unexpected component error')
    assert.deepEqual(warnings, [], 'unexpected Vue warning')
  })
  app.mount(host)
  mounted = true
  if (errors.length) throw errors[0]
  const all = () => descendants(host)
  const find = predicate => all().find(predicate)
  const rows = () => find(element => element.props.id === 'board').children.filter(element => hasClass(element, 'row'))
  const tiles = row => rows()[row].children.filter(element => hasClass(element, 'tile'))
  const letters = row => tiles(row).map(tile => content(tile.children.find(element => hasClass(element, 'front')))).join('')
  const states = row => tiles(row).map(tile => tile.children.find(element => hasClass(element, 'back')).props.class.replace(/^back\s*/, ''))
  const message = () => {
    const element = find(element => hasClass(element, 'message'))
    return element
      ? (element.text + element.children.filter(child => child.type === '#text').map(content).join('')).trim()
      : ''
  }
  const grid = () => find(element => element.type === 'pre')?.text || ''
  const key = async value => {
    for (const listener of listeners) listener({ key: value })
    await runtime.nextTick()
  }
  const type = async value => {
    for (const character of value) await key(character)
  }
  const click = async value => {
    const buttons = all().filter(element => element.type === 'button')
    const button = value === 'Backspace'
      ? buttons.find(element => descendants(element).some(child => child.type === 'svg'))
      : buttons.find(element => content(element) === value)
    assert.ok(button, `rendered keyboard button ${value}`)
    button.props.onClick()
    await runtime.nextTick()
  }
  const advance = async milliseconds => {
    const end = now + milliseconds
    for (;;) {
      const next = [...timers].filter(([, value]) => value.due <= end).sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0]
      if (!next) break
      now = next[1].due
      timers.delete(next[0])
      next[1].fn()
      await runtime.nextTick()
    }
    now = end
    await runtime.nextTick()
  }
  const letterStates = () => {
    const search = vnode => {
      if (!vnode) return undefined
      if (vnode.component && 'letterStates' in vnode.component.props) return vnode.component.props.letterStates
      if (vnode.component) return search(vnode.component.subTree)
      if (Array.isArray(vnode.children)) {
        for (const child of vnode.children) {
          const result = search(child)
          if (result) return result
        }
      }
    }
    return search(host._vnode)
  }
  return {
    rows, tiles, letters, states, message, grid, key, type, click, advance,
    letterStates, listeners, added, removed, errors,
    unmount() { app.unmount(); mounted = false }
  }
}

test('mounts a 6x6 board and handles physical and real virtual keyboard input', async t => {
  const game = mount(t)
  assert.equal(game.rows().length, 6)
  for (let row = 0; row < 6; row++) {
    assert.equal(game.tiles(row).length, 6)
    assert.equal(game.letters(row), '')
  }
  assert.equal(game.listeners.size, 1)
  assert.equal(game.message(), '')
  assert.equal(game.grid(), '')
  await game.key('a')
  await game.key('Shift')
  assert.equal(game.letters(0), '')
  await game.type('1+2')
  await game.click('Backspace')
  assert.equal(game.letters(0), '1+')
  await game.click('2')
  assert.equal(game.letters(0), '1+2')
  await game.type('3456')
  assert.equal(game.letters(0), '1+2345')
})

test('incomplete feedback and shake clear at exactly 1000ms without locking input', async t => {
  const game = mount(t)
  await game.type('1+')
  await game.key('Enter')
  assert.equal(game.message(), 'Not enough numbers')
  assert.ok(hasClass(game.rows()[0], 'shake'))
  assert.deepEqual(game.states(0), Array(6).fill(''))
  await game.advance(999)
  assert.equal(game.message(), 'Not enough numbers')
  assert.ok(hasClass(game.rows()[0], 'shake'))
  await game.key('2')
  assert.equal(game.letters(0), '1+2')
  await game.advance(1)
  assert.equal(game.message(), '')
  assert.ok(!hasClass(game.rows()[0], 'shake'))
  assert.equal(game.letters(1), '')
})

test('rejects a wrong value but permits correction on the same row', async t => {
  const game = mount(t)
  await game.type('0+22+2')
  await game.key('Enter')
  assert.equal(game.message(), 'Your guess must equal 23')
  assert.ok(hasClass(game.rows()[0], 'shake'))
  assert.deepEqual(game.states(0), Array(6).fill(''))
  assert.equal(game.grid(), '')
  await game.key('Backspace')
  await game.key('1')
  assert.equal(game.letters(0), '0+22+1')
  assert.equal(game.letters(1), '')
  await game.advance(1000)
  assert.equal(game.message(), '')
})

test('scores duplicate letters, unwraps keyboard props, and recomputes the row at the 1600ms unlock', async t => {
  const game = mount(t)
  await game.type('2+19+2')
  await game.key('Enter')
  assert.deepEqual(game.states(0), ['present', 'correct', 'present', 'absent', 'correct', 'present'])
  assert.ok(game.tiles(0).every(tile => hasClass(tile, 'revealed')))
  assert.deepEqual({ ...game.letterStates() }, { '+': 'correct', '2': 'present', '1': 'present', '9': 'absent' })
  assert.equal(game.letterStates().__v_isRef, undefined)
  await game.key('0')
  await game.advance(1599)
  await game.key('0')
  assert.equal(game.letters(1), '')
  await game.advance(1)
  await game.key('0')
  assert.equal(game.letters(1), '0')
  assert.equal(game.letters(0), '2+19+2')
  await game.key('Backspace')
  assert.equal(game.letters(1), '')
})

test('second-row win updates persistent feedback, grid, jump, and letter precedence', async t => {
  const game = mount(t)
  await game.type('2+19+2')
  await game.key('Enter')
  await game.advance(1600)
  await game.type('0+22+1')
  await game.key('Enter')
  assert.deepEqual(game.states(1), Array(6).fill('correct'))
  await game.advance(1599)
  assert.equal(game.message(), '')
  assert.equal(game.grid(), '')
  assert.ok(!hasClass(game.rows()[1], 'jump'))
  await game.advance(1)
  assert.equal(game.message(), 'Magnificent')
  assert.equal(game.grid(), '🟨🟩🟨⬜🟩🟨\n🟩🟩🟩🟩🟩🟩')
  assert.ok(hasClass(game.rows()[1], 'jump'))
  assert.ok(!hasClass(game.rows()[0], 'jump'))
  assert.deepEqual({ ...game.letterStates() }, { '+': 'correct', '2': 'correct', '1': 'correct', '9': 'absent', '0': 'correct' })
  await game.key('Backspace')
  await game.key('4')
  await game.key('Enter')
  await game.advance(2000)
  assert.equal(game.letters(1), '0+22+1')
  assert.equal(game.message(), 'Magnificent')
})

test('sixth-row loss shows the answer and permanently locks the existing board', async t => {
  const game = mount(t)
  for (let row = 0; row < 6; row++) {
    await game.type('2+19+2')
    await game.key('Enter')
    if (row < 5) await game.advance(1600)
  }
  await game.advance(1599)
  assert.equal(game.message(), '')
  await game.advance(1)
  assert.equal(game.message(), '0+22+1')
  assert.equal(game.grid(), '')
  assert.equal(game.rows().length, 6)
  assert.ok(game.rows().every(row => !hasClass(row, 'jump')))
  await game.key('Backspace')
  await game.key('0')
  await game.key('Enter')
  await game.advance(2000)
  assert.equal(game.letters(5), '2+19+2')
  assert.equal(game.message(), '0+22+1')
})

test('unmount removes the exact physical keyboard listener', async t => {
  const game = mount(t)
  await game.key('1')
  assert.equal(game.letters(0), '1')
  const listener = game.added[0]
  game.unmount()
  assert.deepEqual(game.removed, [listener])
  assert.equal(game.listeners.size, 0)
  await game.key('2')
})
