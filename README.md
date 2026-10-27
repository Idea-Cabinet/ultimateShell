# UltimateShell

**English** · [简体中文](README.zh-CN.md)

An SSH client for macOS, built with Tauri, Rust, React, and xterm.js.

## Features

- Local terminals and SSH connections
- Multiple tabs with drag-to-reorder and reconnect
- Host groups, search, and recent connections
- Command templates, parameters, and history
- Terminal output search
- Linux server monitoring, process management, and disk usage
- Local and remote file browsing with text previews
- Light/dark themes, English/Chinese UI, and native macOS menus

Still in development. Currently tested on macOS.

## Run

Requires Node.js 22.12+, a recent stable Rust toolchain, OpenSSH, and [Tauri system dependencies](https://v2.tauri.app/start/prerequisites/).

```bash
git clone https://github.com/Idea-Cabinet/ultimateShell.git
cd ultimateShell
npm ci
npm run tauri dev
```

## Build

```bash
npm run tauri build
```

Build output: `src-tauri/target/release/bundle/`.
