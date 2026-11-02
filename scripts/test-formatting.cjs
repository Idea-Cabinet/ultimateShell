const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, mocks = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  }}).outputText;
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`)(name => {
    if (name in mocks) return mocks[name];
    if (name === '../utils/formatDocument') return formatting;
    return require(name);
  }, module, module.exports);
  return module.exports;
}
const formatting = load('src/utils/formatDocument.ts');
const { formatDocument, formatNginx, isFormatShortcut } = formatting;

async function main() {
  const nginx = `# config\nhttp{ server {listen 80; # port\nlocation / {proxy_pass http://127.0.0.1; set $value "a;#{}";set $escaped a\\;b;set $host \${host};} } }`;
  const expected = '# config\nhttp {\n  server {\n    listen 80; # port\n    location / {\n      proxy_pass http://127.0.0.1;\n      set $value "a;#{}";\n      set $escaped a\\;b;\n      set $host ${host};\n    }\n  }\n}\n';
  assert.equal(formatNginx(nginx), expected);
  assert.equal(formatNginx(expected), expected);
  assert.equal(formatNginx('set $x a\\ ;'), 'set $x a\\ ;\n');
  assert.equal(formatNginx('set $x a\\  b;'), 'set $x a\\  b;\n');
  assert.match(formatNginx('location ~ ^/id/[0-9]{1,3}$ {return 200 "ok";}'), /\[0-9\]\{1,3\}\$/);
  assert.equal(formatNginx('server { listen # middle\n80; }'), 'server {\n  listen # middle\n  80;\n}\n');
  for (const invalid of ['server {', 'server { listen 80 }', '}', 'set $x "unterminated;', 'set $x ${bad;']) {
    assert.throws(() => formatNginx(invalid));
  }
  assert.equal(await formatDocument('server{listen 80;}\r\n', 'nginx', 'nginx.conf'), 'server {\r\n  listen 80;\r\n}\r\n');
  const js = 'const n=[1,2].map(x=>({value:x}));const regex=/[{};]/g;';
  const prettyJs = await formatDocument(js, 'javascript', 'file.js');
  assert.match(prettyJs, /const n = \[1, 2\]/);
  assert.match(prettyJs, /const regex = \/\[\{\};\]\/g;/);
  assert.equal(await formatDocument(prettyJs, 'javascript', 'file.js'), prettyJs);
  assert.match(await formatDocument('const n:number=1;export const A=()=> <div>{n}</div>', 'javascript', 'file.tsx'), /const n: number = 1;/);
  const html = await formatDocument('<!doctype html><html><body><pre> a\n  b </pre><script>const x={a:1};</script></body></html>', 'html', 'index.html');
  // HTML ignores the first newline immediately after <pre>.
  assert.equal(html.match(/<pre>([\s\S]*?)<\/pre>/)[1].replace(/^\n/, ''), ' a\n  b ');
  assert.match(html, /const x = \{ a: 1 \};/);
  assert.equal(await formatDocument(html, 'html', 'index.html'), html);
  await assert.rejects(() => formatDocument('const = ;', 'javascript', 'bad.js'));
  await assert.rejects(() => formatDocument('<div><span></div>', 'html', 'bad.html'));
  assert.match(await formatDocument('{"x":1}', 'json', 'file.json'), /"x": 1/);
  assert.ok((await formatDocument('{// comment\n"x":1}', 'json', 'file.jsonc')).includes('// comment'));
  const shortcut = { altKey: true, shiftKey: true, metaKey: false, ctrlKey: false, code: 'KeyF' };
  assert.equal(isFormatShortcut(shortcut), true);
  for (const override of [{ altKey: false }, { shiftKey: false }, { metaKey: true }, { ctrlKey: true }, { code: 'KeyS' }, { isComposing: true }]) {
    assert.equal(isFormatShortcut({ ...shortcut, ...override }), false);
  }
  await testEditor(shortcut);
  console.log('PASS: Nginx strings/comments/variables/blocks, HTML embedded JS, JS/TSX/JSON, invalid syntax, CRLF, idempotence, shortcut and editor undo/race handling');
}

async function testEditor(shortcut) {
  const slots = []; let cursor = 0; let effects = []; let response;
  const react = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; },
    useMemo(fn) { cursor++; return fn(); }, useCallback(fn) { cursor++; return fn; },
    useEffect(fn, deps) { const index = cursor++; if (!(index in slots) || deps.some((d, i) => d !== slots[index][i])) effects.push(fn); slots[index] = deps; },
  };
  const { TextEditorModal, detectLanguage } = load('src/components/TextEditorModal.tsx', {
    react, 'react-dom': { createPortal: tree => tree },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    '../i18n': { useI18n: () => ({ t: key => key }) },
    '../utils/formatDocument': { isFormatShortcut, formatDocument: () => new Promise((resolve, reject) => { response = { resolve, reject }; }) },
  });
  assert.equal(detectLanguage('/etc/nginx/sites-enabled/default'), 'nginx');
  assert.equal(detectLanguage('/etc/nginx/scripts/a.js'), 'javascript');
  const props = { entry: { name: 'test.js', path: '/test.js' }, previewResult: { content: 'const x=1;', is_truncated: false }, isOpen: true, onClose() {}, onSave() {}, onReload() {} };
  global.document ||= { body: {} };
  function render() { cursor = 0; const tree = TextEditorModal(props); const pending = effects; effects = []; for (const effect of pending) effect(); return tree; }
  function find(tree, predicate) { if (!tree || typeof tree !== 'object') return; if (predicate(tree)) return tree; for (const child of [tree.props?.children].flat(Infinity)) { const found = find(child, predicate); if (found) return found; } }
  render(); let tree = render();
  const textarea = () => find(tree, item => item.type === 'textarea');
  const button = () => find(tree, item => item.props?.title?.startsWith('格式化（'));
  const pending = button().props.onClick(); response.resolve('const x = 1;\n'); await pending; tree = render();
  assert.equal(textarea().props.value, 'const x = 1;\n');
  textarea().props.onKeyDown({ currentTarget: { selectionStart: 0, selectionEnd: 0 }, metaKey: true, key: 'z', preventDefault() {} }); tree = render();
  assert.equal(textarea().props.value, 'const x=1;');
  const stale = button().props.onClick();
  textarea().props.onChange({ target: { value: 'new content', selectionStart: 0, selectionEnd: 0 } }); tree = render();
  response.resolve('stale result'); await stale; tree = render();
  assert.equal(textarea().props.value, 'new content');
  const failed = button().props.onClick(); response.reject(new Error('bad syntax')); await failed; tree = render();
  assert.equal(textarea().props.value, 'new content');
  assert.ok(find(tree, item => item.props?.role === 'alert'));
  let prevented = 0;
  tree.props.onKeyDownCapture({ nativeEvent: shortcut, preventDefault() { prevented++; }, stopPropagation() {} });
  assert.equal(prevented, 1); response.resolve('keyboard format'); await new Promise(resolve => setImmediate(resolve)); tree = render();
  assert.equal(textarea().props.value, 'keyboard format');
  props.previewResult = { ...props.previewResult, is_truncated: true }; tree = render();
  assert.equal(button().props.disabled, true);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
