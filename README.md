# UltimateShell 🚀

下一代开源、极速、安全的现代化服务器终端与运维管理利器（FinalShell 现代开源替代品）。

## ✨ 核心特性（Phase 1 已就绪）

- **极速与超轻量**：基于 **Tauri 2.0 (Rust)** + **React 19** + **TailwindCSS**，告别传统 Java Swing/Electron 的臃肿与内存泄漏。
- **现代化终端体验**：集成 VS Code 同款 **`xterm.js`**，支持全彩 TrueColor、Menlo 编程字体、丝滑文字渲染。
- **原生 PTY 伪终端通道**：Rust 底层基于 `portable-pty`，无感支持系统 SSH、SSH-Agent、JumpHost、本地终端与终端动态 Resizing。
- **多标签会话管理**：支持多个本地终端与远程 SSH 服务器标签页并行切换，后台会话不中断。
- **主机与分组管理**：支持新建、编辑、删除服务器连接，按组分类折叠与实时关键字搜索。
- **快捷命令工具栏**：支持一键向当前终端注入常用运维排错指令（`htop`、`df -h`、`docker ps` 等）。
- **一键从 FinalShell 导入**：原生自动识别本机 FinalShell 配置目录并一键无缝迁移所有服务器连接列表！

---

## 🛠️ 本地运行与调试

```bash
# 1. 进入项目目录
cd /Users/mebius/.gemini/antigravity/scratch/ultimateShell

# 2. 启动桌面端开发调试窗口
npm run tauri dev

# 3. 编译打包生成可执行桌面应用程序 (.dmg / .app)
npm run tauri build
```
