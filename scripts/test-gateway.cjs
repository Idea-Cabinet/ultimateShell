const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
function load(file){const m={exports:{}};vm.runInThisContext(`(function(module,exports){${ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText}\n})`)(m,m.exports);return m.exports;}
const {auditResult,approvalLabel}=load('src/utils/gatewayAudit.ts');
for(const s of ['success','executed'])assert.deepEqual(auditResult(s,0),{label:'成功',tone:'success'});
assert.equal(auditResult('success',null).tone,'success');
assert.equal(auditResult('success').tone,'success');
for(const s of ['executed','error','failed'])assert.equal(auditResult(s,7).tone,'error');
assert.equal(auditResult('unknown',null).label,'结果待核查');assert.equal(auditResult('timeout',null).label,'审批超时');assert.equal(auditResult('running').label,'执行中');
assert.equal(approvalLabel('user'),'人工批准');assert.equal(approvalLabel('auto'),'策略自动放行');assert.match(approvalLabel(undefined,true),/来源未区分/);
const {gatewaySkillMarkdown}=load('src/utils/gatewayGuide.ts');const guide=gatewaySkillMarkdown(39281,2222);
assert.equal(fs.readFileSync('public/AGENT_SKILL.md','utf8'),guide);
for(const required of ['/api/jobs','/api/uploads','SHA-256','request_id','offset','overwrite','不支持','32 KiB','120秒'])assert.ok(guide.includes(required),required);
for(const forbidden of ['StrictHostKeyChecking no','UserKnownHostsFile /dev/null','mcp-remote'])assert.ok(!guide.includes(forbidden));
console.log('PASS: legacy/current audit status, nonzero exits, unknown outcomes, approval provenance, generated/static skill parity and upload/job instructions');
