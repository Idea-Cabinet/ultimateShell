# UltimateShell AI Agent Security Gateway Skill (双轨制)

## 1. 概述与核心安全架构
本 Skill 允许 AI Agent 通过 UltimateShell 提供的本地安全隧道网关，安全受控地操作用户的 Linux/Unix 服务器。网关采用**双轨制**，无论是命令行终端 Agent 还是大模型插件都可以无缝接入。

### 零泄漏安全原则
- 🔒 **私钥与密码零泄露**：用户的服务器登录密码、SSH 私钥严格存储于 UltimateShell 客户端的本地 Rust 内存与硬件指纹安全保险库中。AI Agent 仅通过逻辑名称（如 `服务器名称` 或 `IP`）指定目标，AI 端绝对拿不到、也读不到任何密码和私钥。
- 🛡️ **三级本地审批机制**：
  1. **请求批准 (Strict)**：所有写操作（增删改、配置变更、系统重启）均需用户在本地弹窗逐条人工确认。
  2. **帮我批准 (Smart，默认推荐)**：系统运维只读查询与常规安全操作自动放行，仅在检测到高危指令（如 `rm -rf`, `mkfs`, `iptables -F`, `dd` 等）时触发弹窗询问。
  3. **全部批准 (Auto)**：全部自动通过，无弹窗打扰，但所有指令、耗时及输出完整记录于本地审计日志中。
- 🧼 **敏感输出自动脱敏**：网关自动对命令输出中的密码、API Token、私钥标识进行掩码处理（`***`）。

---

## 2. 轨道一：原生 SSH 命令行直连 (推荐 Claude Code CLI / 终端 Agent)

针对拥有 Bash/终端命令执行能力的 AI Agent，可以直接像连普通 SSH 服务器一样执行命令，无需任何 HTTP 客户端。

### 2.1 连接地址与端口
- **Host**: `127.0.0.1`
- **端口**: `2222`（如冲突自动回退至 `39222`）
- **认证**: 回环网络免密放行，零密码要求

### 2.2 命令行执行方式
```bash
# 格式: ssh -p <网关端口> <目标服务器名称>@127.0.0.1 "<command>"
ssh -p 2222 生产主库@127.0.0.1 "systemctl status nginx"
```

### 2.3 终端审批感知
当命令触发三级策略拦截时：
1. SSH 终端 stderr 将实时显示：
   `[UltimateShell Gateway] ⚠️ 命令已挂起等待客户端审批...`
2. 用户桌面即时弹出审批卡片；
3. 用户在 UI 点击【批准】后，真实服务器命令继续执行，输出实时回显到 SSH 终端。

### 2.4 可选：配置快捷别名 (`~/.ssh/config`)
将以下配置加入外部 Agent 的 `~/.ssh/config`，即可直接使用 `ssh ai-生产主库 "<cmd>"`：
```ssh-config
Host ai-*
  HostName 127.0.0.1
  Port 2222
  UserKnownHostsFile /dev/null
  StrictHostKeyChecking no
```

---

## 3. 轨道二：HTTP / MCP API 接口 (推荐 Claude Desktop / Cursor / Web Agent)

### 3.1 网关连接规范
- **默认监听地址**：`http://127.0.0.1:39281`
- **鉴权方式**：HTTP Header `Authorization: Bearer <GATEWAY_TOKEN>`
  （Token 可在 UltimateShell 界面底部「AI 网关」面板中一键查看与复制）

### 3.2 接口 1: 获取服务器列表 (`list_servers`)
- **Method**: `GET`
- **Path**: `/api/servers`
- **响应示例**:
```json
{
  "active_sessions": [
    { "session_id": "sess_1", "title": "生产主库 (192.168.1.100)", "server_name": "生产主库" }
  ],
  "saved_hosts": [
    { "id": "h_1", "name": "生产主库", "host": "192.168.1.100", "port": 22, "username": "root" },
    { "id": "h_2", "name": "测试服务器", "host": "192.168.1.105", "port": 22, "username": "deploy" }
  ]
}
```

### 3.3 接口 2: 执行命令 (`exec_command`)
- **Method**: `POST`
- **Path**: `/api/exec`
- **请求体 (JSON)**:
```json
{
  "server": "生产主库",
  "command": "systemctl status nginx",
  "agent_name": "Antigravity Agent",
  "timeout_secs": 30
}
```
- **响应示例**:
```json
{
  "exit_code": 0,
  "stdout": "● nginx.service - A high performance web server\n   Active: active (running)...",
  "stderr": "",
  "duration_ms": 128,
  "risk_level": "Safe",
  "approved_by_user": false,
  "audit_id": "audit_abc123"
}
```

### 3.4 接口 3: 读取远程文件 (`read_file`)
- **Method**: `POST`
- **Path**: `/api/read_file`
- **请求体 (JSON)**:
```json
{
  "server": "生产主库",
  "path": "/etc/nginx/nginx.conf"
}
```

---

## 4. 推荐 Agent 工作流程与对话范例

### 用户场景示例：
> 用户问：“帮我看看腾讯云服务器的 nginx 是否正常？”

### Agent 标准执行步骤：
1. **匹配服务器**：调用 `GET /api/servers` 或在本地主机配置中匹配“腾讯云服务器”。
2. **检查服务**：
   - 原生 SSH 方式：`ssh -p 2222 腾讯云服务器@127.0.0.1 "systemctl status nginx"`
   - 或 HTTP API 方式：`POST /api/exec {"server": "腾讯云服务器", "command": "systemctl status nginx"}`
3. **测试配置**：执行 `nginx -t` 查看语法错误。
4. **归纳诊断并给出建议**：根据获得的信息直接回答用户，给出排查结论。
