import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";

type Item = { id: string };
type DropTarget = { id: string; position: "left" | "right" };

// Internal reordering uses pointer events instead of WebView/native file drag-and-drop.
export function usePointerReorder<T extends Item>(
  items: T[],
  onReorder: (items: T[]) => void,
  containerRef: RefObject<HTMLElement | null>,
) {
  const latest = useRef({ items, onReorder });
  latest.current = { items, onReorder };
  const cleanupRef = useRef<(() => void) | null>(null);
  const suppressClickRef = useRef(false);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  useEffect(() => () => {
    cleanupRef.current?.();
    clearTimeout(clickTimerRef.current);
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>, sourceId: string) => {
    if (event.button !== 0 || !event.isPrimary) return;
    if ((event.target as Element).closest("button, input, [data-reorder-ignore]")) return;
    cleanupRef.current?.();
    clearTimeout(clickTimerRef.current);
    suppressClickRef.current = false;
    const { clientX: startX, clientY: startY, pointerId } = event;
    let dragging = false;

    const targetAt = (x: number, y: number): DropTarget | null => {
      const element = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-reorder-id]");
      if (!element || !containerRef.current?.contains(element)) return null;
      const id = element.dataset.reorderId!;
      if (id === sourceId) return null;
      const rect = element.getBoundingClientRect();
      return { id, position: x > rect.left + rect.width / 2 ? "right" : "left" };
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("blur", cancel);
      cleanupRef.current = null;
    };
    const finish = () => {
      cleanup();
      setDraggedId(null);
      setDropTarget(null);
      // The browser dispatches click after pointerup; do not select/sort after a drag.
      if (dragging) {
        suppressClickRef.current = true;
        clickTimerRef.current = setTimeout(() => { suppressClickRef.current = false; }, 0);
      }
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      if (!dragging && Math.hypot(e.clientX - startX, e.clientY - startY) < 5) return;
      dragging = true;
      suppressClickRef.current = true;
      setDraggedId(sourceId);
      e.preventDefault();
      const container = containerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        if (e.clientX < rect.left + 24) container.scrollLeft -= 16;
        else if (e.clientX > rect.right - 24) container.scrollLeft += 16;
      }
      setDropTarget(targetAt(e.clientX, e.clientY));
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      const target = dragging ? targetAt(e.clientX, e.clientY) : null;
      finish();
      if (!target) return;
      const { items: current, onReorder: commit } = latest.current;
      const source = current.find(item => item.id === sourceId);
      if (!source || !current.some(item => item.id === target.id)) return;
      const reordered = current.filter(item => item.id !== sourceId);
      const index = reordered.findIndex(item => item.id === target.id);
      reordered.splice(index + (target.position === "right" ? 1 : 0), 0, source);
      if (reordered.some((item, i) => item.id !== current[i].id)) commit(reordered);
    };
    const cancel = (e: Event) => {
      if (e instanceof PointerEvent && e.pointerId !== pointerId) return;
      finish();
    };
    const keydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); finish(); }
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", keydown);
    window.addEventListener("blur", cancel);
    cleanupRef.current = cleanup;
  };

  return { draggedId, dropTarget, onPointerDown, suppressClick: () => suppressClickRef.current };
}
