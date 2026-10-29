# UltimateShell AI Agent Security Gateway Skill

## 1. 概述与核心安全架构
本 Skill 允许 AI Agent 通过 UltimateShell 提供的本地安全隧道（Local Loopback Gateway），安全受控地操作用户的 Linux/Unix 服务器。

### 零泄漏安全原则
- 🔒 **私钥与密码零泄露**：用户的服务器登录密码、SSH 私钥严格存储于 UltimateShell 客户端的本地 Rust 内存与安全保险库中。AI Agent 仅通过逻辑名称（如 `服务器名称` 或 `IP`）指定目标，AI 端绝对拿不到任何密码和私钥。
- 🛡️ **三级本地审批机制**：
  1. **请求批准 (Strict)**：所有写操作（增删改、配置变更、系统重启）均需用户在本地弹窗逐条人工确认。
  2. **帮我批准 (Smart)**：系统运维只读查询与常规安全操作自动放行，仅在检测到高危指令（如 `rm -rf`, `mkfs`, `iptables -F`, `dd` 等）时触发弹窗询问。
  3. **全部批准 (Auto)**：全部自动通过，无弹窗打扰，但所有指令、耗时及输出完整记录于本地审计日志中。
- 🧼 **敏感输出自动脱敏**：网关自动对命令输出中的密码、API Token、私钥标识进行掩码处理（`***`）。

---

## 2. 网关连接规范

- **默认监听地址**：`http://127.0.0.1:39281`
- **鉴权方式**：HTTP Header `Authorization: Bearer <GATEWAY_TOKEN>`
  （Token 可在 UltimateShell 界面底部「AI 网关」面板中一键查看与复制）

---

## 3. 可用 API 接口说明

### 3.1 获取所有可用服务器列表 (`list_servers`)
- **Method**: `GET`
- **Path**: `/api/servers`
- **说明**: 获取当前用户在 UltimateShell 中已配置的所有主机，以及当前正处于连接状态的活跃终端标签。
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

---

### 3.2 执行命令 (`exec_command`)
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
- **字段说明**:
  - `server`: 目标服务器名称或 Host 地址。
  - `command`: 需要执行的 Bash/Shell 指令。
  - `agent_name`: 调用方 Agent 名称（用于本地审计显示）。
  - `timeout_secs`: 命令最长超时时间（秒，默认 30）。
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

---

### 3.3 读取远程文件内容 (`read_file`)
- **Method**: `POST`
- **Path**: `/api/read_file`
- **请求体 (JSON)**:
```json
{
  "server": "生产主库",
  "path": "/etc/nginx/nginx.conf"
}
```
- **响应示例**:
```json
{
  "path": "/etc/nginx/nginx.conf",
  "content": "user www-data;\nworker_processes auto;...",
  "size": 1420
}
```

---

## 4. 推荐 Agent 工作流程与对话范例

### 用户场景示例：
> 用户问：“帮我看看腾讯云服务器的 nginx 是否正常？”

### Agent 标准执行步骤：
1. **匹配服务器**：调用 `GET /api/servers`，在返回列表中寻找最匹配“腾讯云服务器”的条目。
2. **检查进程/服务**：调用 `POST /api/exec`，执行 `systemctl status nginx` 或 `ps aux | grep nginx`。
3. **测试配置**：如果服务异常，调用 `POST /api/exec` 执行 `nginx -t` 查看语法错误。
4. **读取日志**：如有报错，调用 `POST /api/exec` 执行 `tail -n 30 /var/log/nginx/error.log`。
5. **归纳诊断并给出建议**：根据获得的信息直接回答用户，给出明确排查结论。如需重启服务，可向网关发起 `systemctl restart nginx`，触发本地客户端审批弹窗。
