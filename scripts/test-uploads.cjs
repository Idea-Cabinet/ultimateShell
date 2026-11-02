// Regression tests for drop ownership, async listener disposal, upload scheduling and one-way directory sync.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const tick = () => new Promise(resolve => setImmediate(resolve));

function loader(mocks, globals = {}) {
  const cache = new Map();
  function load(file) {
    file = path.resolve(file);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    }}).outputText;
    const context = vm.createContext({ console, Promise, Set, Map, Date, Math, Error, setTimeout, clearTimeout, ...globals });
    const execute = vm.runInContext(`(function(require,module,exports){${code}\n})`, context);
    execute(name => {
      if (name in mocks) return mocks[name];
      if (name.startsWith('.')) {
        const base = path.resolve(path.dirname(file), name);
        return load([base + '.ts', base + '.tsx', base].find(p => fs.existsSync(p)));
      }
      throw new Error(`Unexpected import: ${name}`);
    }, module, module.exports);
    return module.exports;
  }
  return load;
}

async function testDrops() {
  let hit; let registration; let handler; let stopped = 0; const calls = [];
  const terminal = { contains: element => element === 'terminal' };
  const files = { contains: element => element === 'files' };
  const load = loader({ react: {}, '@tauri-apps/api/core': { invoke: async () => {} },
    '@tauri-apps/api/webview': { getCurrentWebview: () => ({ onDragDropEvent: callback => {
      handler = callback; return new Promise(resolve => { registration = resolve; });
    }}) },
  }, { window: { devicePixelRatio: 2 }, document: { elementFromPoint: (x, y) => {
    assert.equal(y, 100); assert.equal(x, 150); return hit;
  }}});
  const { registerFileDropTarget } = load(path.join(root, 'src/hooks/useFileDrop.ts'));
  const stale = registerFileDropTarget({ element: { current: terminal }, hover() {}, drop() { calls.push('STALE'); } });
  const oldHandler = handler; const oldRegistration = registration;
  stale(); oldRegistration(() => stopped++); await tick(); assert.equal(stopped, 1);
  const removeTerminal = registerFileDropTarget({ element: { current: terminal }, hover() {}, drop: paths => calls.push(['terminal', ...paths]) });
  const removeFiles = registerFileDropTarget({ element: { current: files }, hover() {}, drop: paths => calls.push(['files', ...paths]) });
  registration(() => stopped++); await tick();
  const event = { payload: { type: 'drop', paths: ['/tmp/a', '/tmp/a'], position: { x: 300, y: 200 } } };
  hit = 'files'; handler(event); oldHandler(event); await tick();
  assert.equal(JSON.stringify(calls), JSON.stringify([['files', '/tmp/a']]));
  hit = 'terminal'; handler(event); await tick();
  assert.equal(calls.length, 2); assert.equal(calls[1][0], 'terminal');
  hit = 'modal'; handler(event); await tick(); assert.equal(calls.length, 2);
  removeTerminal(); removeFiles(); assert.equal(stopped, 2);
  handler(event); await tick(); assert.equal(calls.length, 2);
  const hovers = {};
  const terminalOff = registerFileDropTarget({ element: { current: terminal }, group: 'session-a', forwardToGroup: true,
    hover: value => { hovers.terminal = value; }, drop: () => calls.push('fallback') });
  const filesOff = registerFileDropTarget({ element: { current: files }, group: 'session-a',
    hover: value => { hovers.files = value; }, drop: () => calls.push('forwarded-to-files') });
  const otherOff = registerFileDropTarget({ element: { current: files }, group: 'session-b',
    hover: value => { hovers.other = value; }, drop: () => calls.push('wrong-session') });
  registration(() => stopped++); await tick();
  hit = 'terminal';
  handler({ payload: { type: 'over', position: event.payload.position } });
  assert.equal(hovers.files, true); assert.equal(hovers.other, false);
  handler(event); await tick();
  assert.equal(calls[calls.length - 1], 'forwarded-to-files');
  assert.equal(hovers.files, false);
  filesOff(); handler(event); await tick();
  assert.equal(calls[calls.length - 1], 'fallback');
  terminalOff(); otherOff();
  console.log('PASS: one drop owner, terminal forwarding, session-scoped file-list hints, Retina coordinates and listener cleanup');
}

async function testQueueAndDirectories() {
  const slots = []; let cursor = 0; const effects = []; const listeners = new Map(); const pending = []; const invocations = [];
  const react = {
    createContext: () => ({ Provider: 'provider' }),
    useState: initial => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    useRef: initial => { const index = cursor++; return slots[index] ||= { current: initial }; },
    useCallback: callback => { cursor++; return callback; },
    useEffect: (effect, dependencies) => {
      const index = cursor++;
      if (!(index in slots) || dependencies.some((d, i) => d !== slots[index][i])) effects.push(effect);
      slots[index] = dependencies;
    },
  };
  const load = loader({ react, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
    '@tauri-apps/api/event': { listen: async (name, callback) => { listeners.set(name, callback); return () => listeners.delete(name); } },
    '@tauri-apps/api/core': { invoke: (name, args) => {
      invocations.push({ name, args });
      if (name === 'fs_upload_file') return new Promise((resolve, reject) => pending.push({ args, resolve, reject }));
      return Promise.resolve(true);
    } },
  }, { localStorage: { getItem: () => null, setItem() {} } });
  const { TransferProvider } = load(path.join(root, 'src/context/TransferContext.tsx'));
  function render() { cursor = 0; const result = TransferProvider({ children: null }).props.value; while (effects.length) effects.shift()(); return result; }
  let ctx = render(); await tick();
  ctx.followTerminalDirectory('session', '/srv/app'); ctx = render();
  ctx.setDirectory('session', '/srv/uploads'); ctx = render();
  ctx.followTerminalDirectory('session', '/srv/app'); ctx = render();
  assert.equal(ctx.directories.session.path, '/srv/uploads');
  ctx.followTerminalDirectory('session', '/'); ctx = render(); assert.equal(ctx.directories.session.path, '/');
  ctx.followTerminalDirectory('session', ''); ctx = render(); assert.equal(ctx.directories.session.path, '/');
  const a = ctx.startUpload('session', 'host', '/tmp/a', '/srv/uploads');
  assert.equal(a, ctx.startUpload('session', 'host', '/tmp/a', '/srv/uploads'));
  const b = ctx.startUpload('session', 'host', '/tmp/b', '/srv/uploads');
  const c = ctx.startUpload('session', 'host', '/tmp/c', '/srv/uploads');
  assert.equal(pending.length, 2);
  let finished = false; a.then(() => { finished = true; }); await tick(); assert.equal(finished, false);
  ctx = render(); const queued = ctx.tasks.find(t => t.srcPath === '/tmp/c');
  await ctx.cancelTransfer(queued.id); ctx = render();
  listeners.get('file-transfer-progress')({ payload: { task_id: queued.id, transferred: 1, total: 2, speed: 1 } });
  listeners.get('file-transfer-status')({ payload: { task_id: queued.id, status: 'error', error: 'late event' } });
  ctx = render(); assert.equal(ctx.tasks.find(t => t.id === queued.id).status, 'cancelled');
  pending[0].resolve(); await tick(); assert.equal(pending.length, 2); assert.equal(finished, true);
  pending[1].resolve(); await Promise.all([a, b, c]); ctx = render();
  assert.equal(ctx.tasks.filter(t => t.status === 'completed').length, 2);
  const d = ctx.startUpload('session', 'host', '/tmp/a', '/different');
  assert.equal(pending.length, 3); pending[2].reject('permission denied'); await d; ctx = render();
  assert.equal(ctx.tasks[0].status, 'error');
  // The cancellation IPC may acknowledge after the backend upload has already returned.
  const e = ctx.startUpload('session', 'host', '/tmp/active', '/srv/uploads'); ctx = render();
  const active = ctx.tasks.find(t => t.srcPath === '/tmp/active');
  const cancelling = ctx.cancelTransfer(active.id); pending[3].resolve();
  await Promise.all([e, cancelling]); ctx = render();
  assert.equal(ctx.tasks.find(t => t.id === active.id).status, 'cancelled');
  assert.equal(invocations.some(i => i.name === 'pty_write'), false);
  console.log('PASS: upload de-duplication, bounded concurrency, actual completion, queued cancellation and one-way directory sync');
}
(async () => { await testDrops(); await testQueueAndDirectories(); })().catch(error => { console.error(error); process.exitCode = 1; });
