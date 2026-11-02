export function gatewaySkillMarkdown(port: number, sshPort: number): string {
  return `# UltimateShell Gateway

通过用户电脑上的 UltimateShell 网关执行已授权的服务器操作。程序必须保持运行，无需置于前台，也无需预先打开服务器终端。

## 连接与认证

### SSH
\`\`\`bash
ssh -p ${sshPort} -l '192.168.3.6' 127.0.0.1 'hostname'
\`\`\`
使用目标服务器的 IP 或 ID 作为 SSH 用户名。保留主机密钥验证；首次信任前，与本机公钥指纹核对：
\`\`\`bash
ssh-keygen -lf ~/.ultimateshell/agent-gateway/host_ed25519.pub
\`\`\`
不要关闭主机密钥验证，不读取真实服务器密码或私钥。

### HTTP API
基址：http://127.0.0.1:${port}
鉴权：Authorization: Bearer <token>
Token 固定保存在本机。单独通过受保护的环境变量或客户端配置传入，不写入 Skill、仓库或日志。

\`\`\`bash
curl --noproxy '*' --fail-with-body \\
  -H "Authorization: Bearer $ULTIMATESHELL_GATEWAY_TOKEN" \\
  http://127.0.0.1:${port}/api/servers
\`\`\`

| 操作 | 接口 | JSON 字段 |
| --- | --- | --- |
| 查询服务器 | GET /api/servers | 无 |
| 执行命令 | POST /api/exec | server, command, agent_name |
| 读取文件 | POST /api/read_file | server, path |

请求必须明确指定服务器；本机操作显式使用 local。当前提供 SSH 和 HTTP API，不提供原生 MCP 协议端点。

## 连接生命周期

AI 连接与用户终端、文件传输隔离。每次请求独立创建命令通道，完成后关闭；底层 SSH 短期复用，空闲约 5 分钟释放。执行中及排队中的请求不参与空闲回收。
仅命令发送前的通道创建失败允许重连一次。发送后超时或连接中断，执行状态可能未知，不自动重跑写操作。

## 审批与异常处理

按用户授权范围操作。需要审批时保持原请求等待桌面批准，不重复提交或切换入口绕过审批。被拒绝后停止。未知结果先做只读核查，不重新下单或重复写入。

连接失败时先区分网关未启动、HTTP 401、主机密钥验证和工具沙箱权限。沙箱返回 Operation not permitted 时按工具权限流程申请本机网络访问，不将网关暴露到外网。
`;
}
