export function auditResult(status: string, exit?: number | null) {
  if ((status === "success" && (exit == null || exit === 0)) || (status === "executed" && exit === 0)) return { label: "成功", tone: "success" };
  if (status === "denied") return { label: "已拒绝", tone: "error" };
  if (status === "timeout") return { label: "审批超时", tone: "error" };
  if (status === "running" || status === "starting") return { label: "执行中", tone: "pending" };
  if (status === "unknown") return { label: "结果待核查", tone: "pending" };
  return { label: "错误", tone: "error" };
}
export function approvalLabel(source?: string, legacy?: boolean) {
  return ({ user: "人工批准", auto: "策略自动放行", session: "沿用会话授权", denied: "人工拒绝", timeout: "审批超时", none: "未进入审批" } as Record<string, string>)[source || ""] || (legacy ? "旧记录：审批来源未区分" : "旧记录：未批准");
}
