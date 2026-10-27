# UltimateShell

[English](README.md) · **简体中文**

一个 macOS SSH 客户端，使用 Tauri、Rust、React 和 xterm.js 开发。

## 功能

- SSH 连接与本地终端
- 主机管理
- 命令库
- Linux 服务器监控与进程管理
- 本地与远程文件浏览

持续开发中，目前在 macOS 上验证。

## 运行

需要 Node.js **22.23.4**、较新的稳定版 Rust、OpenSSH 及 [Tauri 系统依赖](https://v2.tauri.app/start/prerequisites/)。

```bash
git clone https://github.com/Idea-Cabinet/ultimateShell.git
cd ultimateShell
npm ci
npm run tauri dev
```

## 打包

```bash
npm run tauri build
```

输出目录：`src-tauri/target/release/bundle/`。
