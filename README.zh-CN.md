# UltimateShell

[English](README.md) · **简体中文**

一个 macOS SSH 客户端，使用 Tauri、Rust、React 和 xterm.js 开发。

## 功能

- 本地终端与 SSH 连接
- 多标签、拖动排序、断线重连
- 主机分组、搜索、最近连接
- 命令模板、参数填写、命令历史
- 终端内容搜索
- Linux 服务器监控、进程管理、磁盘容量查看
- 本地与远程文件浏览、文本预览
- 深浅色主题、中英文界面、macOS 原生菜单

持续开发中，目前在 macOS 上验证。

## 运行

需要 Node.js 22.12+、较新的稳定版 Rust、OpenSSH 及 [Tauri 系统依赖](https://v2.tauri.app/start/prerequisites/)。

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
