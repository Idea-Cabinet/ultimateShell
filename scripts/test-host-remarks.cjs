const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const host = { id: 'fixture', name: 'Test host', host: 'example.invalid', port: 22, username: 'test', description: 'old note', access_time: 1 };
const tick = () => new Promise(resolve => setImmediate(resolve));
function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return;
  if (predicate(tree)) return tree;
  for (const child of [tree.props?.children].flat(Infinity)) { const found = find(child, predicate); if (found) return found; }
}
function harness(file, exportName, props) {
  let cursor = 0; let effects = []; const slots = [];
  const react = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; },
    useEffect(fn, deps) { const index = cursor++; if (!(index in slots) || deps.some((d, i) => d !== slots[index][i])) effects.push(fn); slots[index] = deps; },
  };
  const mocks = {
    react, 'react-dom': { createPortal: tree => tree },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    '../i18n': { useI18n: () => ({ t: key => key }) },
    '../types': { isDefaultGroup: group => !group || ['默认分组', 'Default'].includes(group) },
    '@tauri-apps/api/core': { invoke: async () => null },
    '@tauri-apps/plugin-dialog': {}, '@tauri-apps/api/window': {}, './ServerPerfMonitor': {},
  };
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  }}).outputText;
  const context = vm.createContext({ console, setTimeout: () => 1, clearTimeout() {}, localStorage: { getItem: () => null }, window: { addEventListener() {}, removeEventListener() {} } });
  vm.runInContext(`(function(require,module,exports){${code}\n})`, context)(name => name in mocks ? mocks[name] : require(name), module, module.exports);
  return () => { cursor = 0; const tree = module.exports[exportName](props); const pending = effects; effects = []; for (const effect of pending) effect(); return tree; };
}
async function main() {
  let opened;
  const props = { hosts: [host], connectedHostIds: new Set(), width: 260, onEdit: value => { opened = value; } };
  const render = harness('src/components/Sidebar.tsx', 'Sidebar', props);
  let tree = render(); tree.props.onMouseEnter();
  props.hosts = [{ ...host, description: 'new note' }]; render(); tree = render();
  assert.ok(find(tree, item => item.props?.title?.includes('new note')));
  find(tree, item => item.props?.title === 'sidebar.menu.editHost').props.onClick({ stopPropagation() {} });
  assert.equal(opened.description, 'new note');
  props.hosts = [{ ...props.hosts[0], access_time: 99 }]; render(); tree = render();
  find(tree, item => item.props?.title === 'sidebar.menu.editHost').props.onClick({ stopPropagation() {} });
  assert.equal(opened.access_time, 1);
  tree.props.onMouseLeave(); tree = render();
  find(tree, item => item.props?.title === 'sidebar.menu.editHost').props.onClick({ stopPropagation() {} });
  assert.equal(opened.access_time, 99);

  let closed = 0; let calls = 0; let saved; let resolve; let reject;
  const modalProps = { isOpen: true, initialHost: host, onClose() { closed++; }, onSave(value) { calls++; saved = value; return new Promise((yes, no) => { resolve = yes; reject = no; }); } };
  const renderModal = harness('src/components/HostModal.tsx', 'HostModal', modalProps);
  renderModal(); let modal = renderModal(); await tick(); modal = renderModal();
  const note = () => find(modal, item => item.props?.placeholder === 'modal.host.descriptionPlaceholder');
  note().props.onChange({ target: { value: 'edited note' } }); modal = renderModal();
  const submit = () => find(modal, item => item.type === 'form').props.onSubmit({ preventDefault() {} });
  const pending = submit(); modal = renderModal();
  assert.equal(closed, 0); assert.equal(saved.description, 'edited note');
  await submit(); assert.equal(calls, 1);
  reject(new Error('disk write failed')); await pending; modal = renderModal();
  assert.equal(closed, 0); assert.equal(note().props.value, 'edited note');
  assert.ok(find(modal, item => item.props?.role === 'alert'));
  const retry = submit(); resolve(); await retry;
  assert.equal(closed, 1);
  console.log('PASS: edited remarks update during hover, reopening uses latest host, access-time sorting stays deferred, save failure preserves input, success closes and repeated submit is blocked');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
