import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { invoke } from "@tauri-apps/api/core";

type Target = {
  element: RefObject<HTMLElement | null>;
  hover: (over: boolean) => void;
  drop: (paths: string[]) => void | Promise<void>;
};
const targets = new Set<Target>();
let generation = 0;
let unlisten: (() => void) | undefined;

export function reportTransferError(operation: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[${operation}]`, message);
  void invoke("fs_log_error", { operation, message }).catch(console.error);
}

// A single WebView listener owns native drops. Never broadcast file paths to every tab.
export function registerFileDropTarget(target: Target) {
  targets.add(target);
  if (targets.size === 1) {
    const current = ++generation;
    void getCurrentWebview().onDragDropEvent((event) => {
      if (current !== generation) return;
      const payload = event.payload;
      let selected: Target | undefined;
      if (payload.type !== "leave") {
        const ratio = window.devicePixelRatio || 1;
        const hit = document.elementFromPoint(payload.position.x / ratio, payload.position.y / ratio);
        if (hit) {
          for (const candidate of targets) {
            const element = candidate.element.current;
            if (element?.contains(hit) && (!selected || selected.element.current?.contains(element))) {
              selected = candidate;
            }
          }
        }
      }
      for (const candidate of targets) candidate.hover(payload.type !== "drop" && candidate === selected);
      if (payload.type === "drop" && selected) {
        const paths = [...new Set(payload.paths)];
        try {
          // Capture the chosen session/path now, before any tab-changing render.
          void Promise.resolve(selected.drop(paths)).catch(error => reportTransferError("file-drop", error));
        } catch (error) { reportTransferError("file-drop", error); }
      }
    }).then(stop => {
      if (current !== generation || targets.size === 0) stop();
      else unlisten = stop;
    }).catch(error => {
      if (current === generation) reportTransferError("file-drop-listener", error);
    });
  }
  return () => {
    targets.delete(target);
    target.hover(false);
    if (targets.size === 0) {
      generation++;
      unlisten?.();
      unlisten = undefined;
    }
  };
}

export function useFileDrop(
  element: RefObject<HTMLElement | null>,
  enabled: boolean,
  onDrop: (paths: string[]) => void | Promise<void>,
) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const callback = useRef(onDrop);
  callback.current = onDrop;
  useEffect(() => {
    if (!enabled) return;
    return registerFileDropTarget({ element, hover: setIsDragOver, drop: async paths => {
      setError(null);
      try { await callback.current(paths); }
      catch (error) {
        setError(error instanceof Error ? error.message : String(error));
        reportTransferError("upload-drop", error);
      }
    } });
  }, [element, enabled]);
  return { isDragOver, error, clearError: () => setError(null) };
}
