export function gatewaySkillMarkdown(port: number, sshPort: number): string {
  return `# UltimateShell Gateway

通过用户电脑上的 UltimateShell 网关执行已授权的服务器操作。程序必须保持运行，无需置于前台，也无需预先打开服务器终端。

## 连接与认证

### SSH
\`\`\`bash
ssh -i ~/.ultimateshell/agent-gateway/client_ed25519 -o IdentitiesOnly=yes -p ${sshPort} -l '192.168.3.6' 127.0.0.1 'hostname'
\`\`\`
使用目标服务器的 IP 或 ID 作为 SSH 用户名。保留主机密钥验证；首次信任前，与本机公钥指纹核对：
\`\`\`bash
ssh-keygen -lf ~/.ultimateshell/agent-gateway/host_ed25519.pub
\`\`\`
网关专用 client_ed25519 由程序生成并设为600权限，只用于本机网关，不是真实服务器私钥。原生 SSH 需要这把专用密钥，不接受匿名连接或任意公钥。不要关闭主机密钥验证，不读取真实服务器密码或私钥。

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
| 创建上传 | POST /api/uploads | server, request_id, path, size, sha256, overwrite=false |
| 上传分块 | POST /api/uploads/{id}/chunk | offset, data（Base64，解码后最多64 KiB） |
| 查看上传 | GET /api/uploads/{id} | 无 |
| 提交/终止 | POST /api/uploads/{id}/commit 或 abort | 无 |
| 清理上传记录 | DELETE /api/uploads/{id} | 仅已完成/已终止 |
| 启动长任务 | POST /api/jobs | server, request_id, command |
| 查询长任务 | GET /api/jobs/{id}?offset=0&stderr_offset=0 | 原始字节偏移 |
| 清理长任务 | DELETE /api/jobs/{id} | 仅已确认结束 |
| 读取审计 | GET /api/audit_logs | 无 |

新建上传或长任务先检查 GET /api/status 的 protocol_version>=2（网关1.2.0及以上），旧版先更新并重新运行。请求必须明确指定服务器；本机操作显式使用 local。当前提供 SSH 和 HTTP API，不提供原生 MCP 协议端点。

## 发布包与长任务

SSH 入口只执行命令，不支持交互式 shell、stdin 文件管道或 SFTP 子系统。不要用 scp，也不要将文件 Base64 塞进命令。同步命令最多32 KiB、120秒，输出最多保留1 MiB；长任务使用 jobs。

上传必须显式提供绝对目标文件路径、文件大小、SHA-256和UUID request_id。单文件最多256 MiB，同时最多4个未完成上传。权限使用保存的登录账号，终端 sudo/su 不会改变身份。默认拒绝覆盖，覆盖需创建时显式 overwrite=true。分块必须连续；同一 offset 重复块只有内容相同才接受。断线后先GET会话，按offset继续；commit中断仍使用同一ID核查，禁止盲目追加或换目录。先写同目录临时文件，完整校验后提交。新文件为600权限；覆盖保留原文件所有者和基本权限，保留失败不替换原文件。覆盖提交额外需要目标Python 3，通过os.replace原子替换，不先删除旧文件。文件传输依赖目标服务器SFTP支持，HTTP分块可续传，远程提交阶段中断后可能重传临时文件。

jobs 在目标服务器保存命令、stdout、stderr和退出码，不依赖网关持续连接。request_id须在首次请求前生成并保存；同ID只启动一次。启动结果未知时只查询同一任务。job.status=running 不等于成功，必须等到success/error并检查exit_code。两路输出按原始字节offset分页读取，显示按UTF-8替换无效字节，不因解码失败重跑。长任务先检查 GET /api/status 的 job_log_mode=bounded_streams，并确认目标服务器安装 Python 3（标准库即可）。每路日志最多保留8 MiB，超限后继续排空而不阻塞任务，查询会标记 stdout_truncated / stderr_truncated；不会给任务数据文件施加大小限制。任务命令需自行设置适合业务的运行时限。

后台命令默认工作目录是独立任务目录；脚本需要项目相对路径时先显式cd到项目目录。采集器异常会先终止并等待本任务进程组，再记录采集错误；不能把采集器退出码冒充任务退出码。任务目录内的脚本及原始输出仅当前远程账号可读写，验收后可按ID清理。清理保留最小ID记录，不允许同一ID再次执行。损坏或不可读记录直接报错，不当成新任务。

项目附带 scripts/gateway-client.py，可用 upload、job、job-status、upload-status、upload-abort、upload-delete、job-cleanup 子命令。它不会自动重试写请求；中断后用已打印ID查询或显式恢复。

审批策略只能在桌面界面修改，HTTP禁止修改。未知脚本及复合Shell命令需要按高危策略审批，不把脚本判为只读。审计区分人工批准、自动放行、拒绝和超时；轮转文件位于 ~/.ultimateshell/agent-gateway/audit.jsonl（仅当前用户可读写），保留两份每份约2 MiB。最近300条载入界面，脚本/载荷仅保存大小和哈希，不保存脚本正文。审计写盘失败会保留有界待写队列并提示错误，下次写入时补写；缓存溢出会明确显示丢失条数。

## 连接生命周期

AI命令、任务控制和文件提交分别使用连接池，与用户终端隔离，避免慢上传阻塞任务查询。目标ID优先于名称/IP，存在多个账号匹配时需明确ID，不随机选择。每次审批固定目标配置，配置改变后拒绝继续旧会话。目标和跳板SSH主机密钥均需匹配本机 ~/.ssh/known_hosts，认证前核验；未知或变化的密钥不自动信任。每次请求独立创建命令通道，完成后关闭；底层 SSH 短期复用，空闲约 5 分钟释放。执行中及排队中的请求不参与空闲回收。
同步命令同时读取stdout/stderr，保留故障前已收到的输出；仅命令发送前的通道创建失败允许重连一次。发送后超时或连接中断，执行状态可能未知，不自动重跑写操作。

## 审批与异常处理

按用户授权范围操作。需要审批时保持原请求等待桌面批准，不重复提交或切换入口绕过审批。被拒绝后停止。未知结果先做只读核查，不重新下单或重复写入。

连接失败时先区分网关未启动、HTTP 401、主机密钥验证和工具沙箱权限。沙箱返回 Operation not permitted 时按工具权限流程申请本机网络访问，不将网关暴露到外网。
`;
}
