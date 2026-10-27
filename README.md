# UltimateShell

**English** · [简体中文](README.zh-CN.md)

A desktop SSH terminal and server management workspace built with Tauri, Rust, React, and xterm.js.

UltimateShell brings terminal sessions, host organization, command templates, and server inspection into one window. It is in early development, with macOS as the primary development and validation platform.

## Features

| Area | Available today |
| --- | --- |
| Terminal | Local shells and SSH sessions, TrueColor output, resizable terminals, configurable font/cursor/scrollback, and output search with regex support |
| Sessions | Multiple tabs, pointer-based reordering, duplicate/reconnect actions, and tab context menus |
| Hosts | Groups, search, recent-use sorting, host duplication, and password or private-key configuration |
| Command library | Searchable templates, editable parameters, command history, and sending commands to the active terminal |
| Server inspection | Linux CPU/memory/load/network/disk-I/O collection, process lists with sorting and termination, and disk mount capacity views |
| File browser | Local/remote directory browsing, a lazy directory tree, metadata, text previews, and reorderable/resizable columns |
| Desktop experience | Light/dark/system appearance, resizable panels, English/Chinese interface options, a system tray, and native macOS menus |

The SSH terminal uses the system OpenSSH client. Monitoring and remote file browsing use separate `ssh2` connections; they do not automatically inherit every setting from your SSH configuration.

## Get started

### Prerequisites

- Node.js **22.12+** and npm, or another Node.js version supported by Vite (`^20.19.0 || >=22.12.0`).
- A recent stable Rust toolchain with Cargo and support for the Rust 2024 edition.
- System OpenSSH (`ssh`) available on `PATH`.
- The native dependencies required by [Tauri](https://v2.tauri.app/start/prerequisites/). On macOS, install Xcode Command Line Tools with `xcode-select --install` if needed.

### Run the desktop app

```bash
git clone https://github.com/Idea-Cabinet/ultimateShell.git
cd ultimateShell
npm ci
npm run tauri dev
```

`npm run dev` starts only the frontend development server. Use `npm run tauri dev` for the desktop app and its Rust-backed terminal, filesystem, and monitoring commands.

### Build and check

```bash
# Type-check and build the frontend
npm run build

# Run the existing Rust unit tests
cargo test --manifest-path src-tauri/Cargo.toml

# Build a desktop application / installer for the current platform
npm run tauri build
```

Desktop build artifacts are written under `src-tauri/target/release/bundle/`. No prebuilt release or code-signing/notarization guarantee is implied by the source repository.

## Everyday workflow

1. Add a host with its address, SSH port, username, optional group, and password or private-key path.
2. Open the host from the sidebar, or create a local terminal using the **+** button.
3. Drag tabs to reorder sessions. Open the command library, file browser, process manager, or disk view from the interface.
4. Drag a file column header to reorder it; drag its right edge to resize it. Column layout is saved locally.
5. Change the application language using the language button in the status bar. This repository opens on the English README; the Chinese documentation is linked above.

### macOS shortcuts

| Shortcut | Action |
| --- | --- |
| `⌘T` / `⌘N` | New local terminal / new server connection |
| `⌘W` | Close the active tab |
| `⌘D` / `⌘R` | Duplicate / reconnect the active session |
| `⌘⇧[` / `⌘⇧]` | Previous / next tab |
| `⌘F` | Search terminal output |
| `⌘B` | Toggle the host sidebar |
| `⌘J` | Toggle the files and operations drawer |
| `⌘⇧C` | Toggle the command library |
| `⌘+` / `⌘-` / `⌘0` | Increase / decrease / reset terminal font size |
| `⌘,` | Settings |

Native menu labels currently use Chinese. Menu actions are grouped under the application menu, sessions, edit, view, and window; panel and font actions are nested in submenus.

## Local data

Host profiles and saved credentials are stored in `~/.ultimateshell/` (`hosts.json` and `credentials.json`). Interface preferences and command history are stored in the app WebView's local storage. There is no cloud synchronization.

Saved passwords use AES-256-GCM with a key derived from local machine information. This is **not** an OS keychain or a hardware-backed secret store. Treat the data directory and backups as sensitive; machine-bound credential data may not decrypt after migration. Review commands before running them, especially process termination and command-library templates.

## Current limits

- macOS is the primary tested platform. Linux support is experimental and unverified here; the current backend contains Unix-specific code, so Windows is not supported as-is.
- Remote performance collection targets Linux `/proc` data. Process and disk views depend on available system commands and permissions.
- The local macOS CPU display is an estimate based on load. Local network and disk-I/O values are currently placeholders and should not be treated as measurements.
- The file browser provides browsing and previews; uploads, downloads, a full remote editor, and cloud synchronization are not implemented.
- Sustained high-volume terminal output can be truncated by frontend flood protection. Complete session recording to disk is not implemented.
- RDP, visual proxy/jump-host configuration, Ping/route diagnostics, and cross-platform parity are not implemented.

## Project layout

```text
src/
  components/    Terminal, host sidebar, file browser, operations panels
  hooks/         Appearance, settings, pointer-based reordering
  i18n/          English and Simplified Chinese interface strings
src-tauri/
  src/           PTY/SSH, local storage, monitoring, files, native menus
  capabilities/  Tauri permissions
```

## Contributing

Open an [issue](https://github.com/Idea-Cabinet/ultimateShell/issues) with reproducible steps, your operating system, and relevant logs, or submit a focused pull request. Never include passwords, private keys, host inventories, or credential files in reports. Include frontend build results and relevant Rust tests with code changes, and state which platform you actually tested.
