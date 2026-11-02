const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
const assert = require('node:assert/strict');
const moduleObject = { exports: {} };
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/utils/inputMethod.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInThisContext(`(function(module,exports){${code}\n})`)(moduleObject,moduleObject.exports);
const {ImeSwitchState} = moduleObject.exports;
function switched(key='Shift',order='before') {
  const state = new ImeSwitchState(); state.start();
  if(order==='before')state.key(key,key==='Shift'?'ShiftLeft':'CapsLock',true,100);
  state.end(110);
  if(order==='after')state.key(key,key==='Shift'?'ShiftLeft':'CapsLock',false,120);
  return state;
}
for(const key of ['Shift','CapsLock'])for(const order of ['before','after']) {
 const state=switched(key,order);
 assert.equal(state.normalize('hello ',150),'hello');
 assert.equal(state.normalize(' ',160),' '); // only the confirmed extra character is removed
}
assert.equal(switched().normalize(' ',150),'');
assert.equal(switched().normalize('word  ',150),'word '); // never trim all whitespace
for(const text of ['中文 ','你好','hello','\t','\n','\u001b[200~pasted \u001b[201~'])assert.equal(switched().normalize(text,150),text);
const normal = new ImeSwitchState();normal.start();normal.end(110);
assert.equal(normal.normalize('hello ',150),'hello ');
const justShift=new ImeSwitchState();justShift.key('Shift','ShiftLeft',true,100);assert.equal(justShift.normalize(' ',110),' ');
const space=switched();space.key(' ','Space',true,130);space.key('Shift','ShiftLeft',false,140);
assert.equal(space.normalize('hello ',150),'hello '); // keyup must not consume genuine Space intent
const shiftedSpace=switched();shiftedSpace.key(' ','Space',true,130);assert.equal(shiftedSpace.normalize(' ',150),' ');
const candidate=new ImeSwitchState();candidate.start();candidate.key(' ','Space',true,100);candidate.end(110);
assert.equal(candidate.normalize('你好',120),'你好');
const expired=switched();assert.equal(expired.normalize(' ',1000),' ');
const paste=switched();paste.reset();assert.equal(paste.normalize('  pasted  ',150),'  pasted  ');
const typing=switched();typing.key('A','KeyA',true,130);assert.equal(typing.normalize('A ',140),'A ');
const stillComposing=switched();stillComposing.start();assert.equal(stillComposing.normalize('abc ',140),'abc ');
const otherField=new ImeSwitchState();assert.equal(otherField.normalize(' ',150),' ');
console.log('PASS: Shift/CapsLock before/after composition, real spaces and candidate selection, paste/multiline, per-field isolation, one-character correction and expiry');
