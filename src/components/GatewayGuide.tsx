import { useEffect, useRef, useState } from "react";
import { Check, Copy, Eye, EyeOff, FileText, Lock, Terminal, Code, ChevronDown } from "lucide-react";
import type { GatewayStatusPayload } from "./AgentGatewayDrawer";
import { gatewaySkillMarkdown } from "../utils/gatewayGuide";

export function GatewayGuide({ status }: { status: GatewayStatusPayload | null }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const port = status?.port || 39281;
  const sshPort = status?.ssh_port || 2222;
  const skill = gatewaySkillMarkdown(port, sshPort);
  const ssh = `ssh -p ${sshPort} -l '192.168.3.6' 127.0.0.1 'hostname'`;
  const curl = `curl --noproxy '*' --fail-with-body \\\n  -H "Authorization: Bearer $ULTIMATESHELL_GATEWAY_TOKEN" \\\n  http://127.0.0.1:${port}/api/servers`;
  const sshConfig = `Host ultimateshell-gateway\n  HostName 127.0.0.1\n  Port ${sshPort}\n  StrictHostKeyChecking ask\n`;
  const copy = async (id: string, text: string) => {
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(null), 2000);
    } catch { setCopyError("复制失败，请选择文本手动复制。"); }
  };
  const copyButton = (id: string, text: string, label: string, primary = false) => (
    <button type="button" onClick={() => void copy(id, text)} disabled={!text}
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-[11px] font-medium transition disabled:opacity-40 ${primary
        ? "bg-[#007AFF] text-white hover:bg-[#0A84FF] shadow-sm"
        : "border border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:bg-[var(--hover-item)] hover:text-[var(--text-primary)]"}`}>
      {copied === id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied === id ? "已复制" : label}
    </button>
  );
  const code = (text: string) => <pre className="overflow-x-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] p-3.5 font-mono text-[11px] leading-6 text-[var(--text-primary)] select-text"><code>{text}</code></pre>;

  return <div className="space-y-4 text-[12px] leading-relaxed" data-testid="gateway-guide">
    <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#007AFF]/10 text-[#007AFF]"><FileText className="h-5 w-5" /></div>
          <div><p className="text-[10px] font-semibold tracking-widest text-[var(--text-tertiary)]">AI SKILL</p>
            <h3 className="mt-0.5 text-[16px] font-semibold tracking-tight">接入文档</h3>
            <p className="mt-1 text-[11px] text-[var(--text-secondary)]">复制给 AI，按文档连接与执行已授权的操作。</p></div>
        </div>
        {copyButton("skill", skill, "复制 Skill 文档", true)}
      </div>
      <div className="mt-5 flex flex-wrap gap-2 border-t border-[var(--border-subtle)] pt-4">
        {["无需保持前台", "独立 AI 连接", "空闲 5 分钟释放"].map(text => <span key={text} className="rounded-md bg-[var(--hover-item)] px-2 py-1 text-[10.5px] text-[var(--text-secondary)]">{text}</span>)}
      </div>
      <details className="group mt-4 rounded-lg border border-[var(--border-subtle)]">
        <summary className="flex cursor-pointer list-none items-center justify-between px-3.5 py-2.5 text-[11px] font-medium text-[var(--text-secondary)]">预览 SKILL.md<ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" /></summary>
        <pre className="max-h-80 overflow-auto border-t border-[var(--border-subtle)] bg-[var(--bg-app)] px-4 py-3 font-mono text-[11px] leading-6 whitespace-pre-wrap break-words text-[var(--text-secondary)] select-text">{skill}</pre>
      </details>
    </section>
    {copyError && <p role="alert" className="rounded-lg bg-rose-500/10 px-3 py-2 text-rose-500">{copyError}</p>}

    <section className="space-y-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 font-semibold"><Terminal className="h-4 w-4 text-[#007AFF]" />SSH 命令行<span className="rounded bg-[#007AFF]/10 px-1.5 py-0.5 text-[10px] font-normal text-[#007AFF]">CLI</span></h4>
        {copyButton("ssh", ssh, "复制命令")}
      </div>
      <p className="text-[11px] text-[var(--text-secondary)]">将示例 IP 换成目标服务器 IP 或 ID，网关按当前审批策略执行。</p>
      {code(ssh)}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[10.5px] text-[var(--text-tertiary)]"><span>首次连接需核对并信任本机网关公钥。</span>{copyButton("ssh-config", sshConfig, "复制 SSH 配置")}</div>
    </section>

    <section className="space-y-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="flex items-center gap-2 font-semibold"><Lock className="h-4 w-4 text-[#007AFF]" />HTTP 认证</h4><span className="rounded-md bg-[var(--hover-item)] px-2 py-1 font-mono text-[10.5px] text-[var(--text-secondary)]">Bearer Token</span></div>
      <div className="flex min-w-0 items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] p-2">
        <code className="min-w-0 flex-1 break-all px-1 font-mono text-[11px] text-[var(--text-secondary)] select-text">{status?.token ? (showToken ? status.token : "••••••••••••••••••••••••") : "网关状态加载中"}</code>
        <button type="button" onClick={() => setShowToken(value => !value)} aria-label={showToken ? "隐藏 Token" : "显示 Token"} aria-pressed={showToken} className="shrink-0 rounded-md p-2 text-[var(--text-tertiary)] hover:bg-[var(--hover-item)]">{showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</button>
        {copyButton("token", status?.token || "", "复制")}
      </div>
      <p className="text-[10.5px] text-[var(--text-tertiary)]">重启后保持不变。通过受保护的客户端配置传入，Skill 文档不包含 Token。</p>
    </section>

    <section className="space-y-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="flex items-center gap-2 font-semibold"><Code className="h-4 w-4 text-[#007AFF]" />HTTP API</h4>{copyButton("http", curl, "复制示例")}</div>
      <p className="break-all font-mono text-[11px] text-[var(--text-secondary)]">http://127.0.0.1:{port}</p>
      {code(curl)}
      <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
        <table className="w-full text-left text-[11px]"><thead className="bg-[var(--bg-app)] text-[var(--text-tertiary)]"><tr>{["操作", "接口", "字段"].map(title => <th key={title} className="px-3 py-2 font-medium">{title}</th>)}</tr></thead>
          <tbody className="text-[var(--text-secondary)]">{[["查询服务器", "GET /api/servers", "—"], ["执行命令", "POST /api/exec", "server, command, agent_name"], ["读取文件", "POST /api/read_file", "server, path"]].map(row => <tr key={row[0]} className="border-t border-[var(--border-subtle)]">{row.map((cell, index) => <td key={cell} className={`px-3 py-2 ${index ? "font-mono whitespace-nowrap" : "whitespace-nowrap"}`}>{cell}</td>)}</tr>)}</tbody>
        </table>
      </div>
      <p className="text-[10.5px] text-[var(--text-tertiary)]">当前提供 SSH 与 HTTP API，MCP 客户端需要协议适配。工具沙箱拦截本机网络时，需按工具流程申请访问权限。</p>
    </section>
  </div>;
}
