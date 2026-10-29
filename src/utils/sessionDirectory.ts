export interface SessionDirectory { path: string; terminalPath?: string }

// Browsing changes only path. A terminal directory change moves the tree once;
// polling the same terminal path must not undo a user's manual tree navigation.
export function followTerminalDirectory(previous: SessionDirectory | undefined, terminalPath: string): SessionDirectory | undefined {
  if (!terminalPath.startsWith("/") || terminalPath.includes("\n")) return previous;
  if (previous?.terminalPath === terminalPath) return previous;
  return { path: terminalPath, terminalPath };
}
