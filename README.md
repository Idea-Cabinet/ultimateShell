# UltimateShell

**English** · [简体中文](README.zh-CN.md)

An SSH client for macOS, built with Tauri, Rust, React, and xterm.js.

## Features

- SSH connections and local terminals
- Host management
- Command library
- Linux server monitoring and process management
- Local and remote file browsing

Still in development. Currently tested on macOS.

## Run

Requires Node.js **22.23.4**, a recent stable Rust toolchain, OpenSSH, and [Tauri system dependencies](https://v2.tauri.app/start/prerequisites/).

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
