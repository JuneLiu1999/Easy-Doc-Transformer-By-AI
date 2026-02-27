import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export type SelectionRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

function normalizeRect(x1: number, y1: number, x2: number, y2: number): SelectionRect {
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const right = Math.max(x1, x2);
  const bottom = Math.max(y1, y2);

  return {
    x: left,
    y: top,
    w: right - left,
    h: bottom - top
  };
}

function rectsIntersect(a: SelectionRect, b: SelectionRect): boolean {
  const aRight = a.x + a.w;
  const aBottom = a.y + a.h;
  const bRight = b.x + b.w;
  const bBottom = b.y + b.h;

  return a.x < bRight && aRight > b.x && a.y < bBottom && aBottom > b.y;
}

function pruneAncestorSelections(ids: Set<string>, container: HTMLElement): string[] {
  const elements = Array.from(container.querySelectorAll<HTMLElement>("[data-block-id]"));
  const selectedElements = elements.filter((el) => {
    const id = el.dataset.blockId;
    return Boolean(id && ids.has(id));
  });

  const keep = new Set<string>();
  for (const element of selectedElements) {
    const id = element.dataset.blockId;
    if (!id) {
      continue;
    }
    const hasSelectedDescendant = selectedElements.some((candidate) => candidate !== element && element.contains(candidate));
    if (!hasSelectedDescendant) {
      keep.add(id);
    }
  }
  return Array.from(keep);
}

export function useBlockSelection(containerRef: RefObject<HTMLElement | null>) {
  const [isSelectingMode, setIsSelectingMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(null);

  const dragStartRef = useRef<{ x: number; y: number; shift: boolean } | null>(null);

  const clearSelection = useCallback(() => {
    setSelectedIds([]);
    setSelectionRect(null);
  }, []);

  const exitSelectingMode = useCallback(() => {
    setIsSelectingMode(false);
    clearSelection();
  }, [clearSelection]);

  const enterSelectingMode = useCallback(() => {
    setIsSelectingMode(true);
  }, []);

  useEffect(() => {
    if (!isSelectingMode) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        exitSelectingMode();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [exitSelectingMode, isSelectingMode]);

  useEffect(() => {
    if (!isSelectingMode) {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      if (!container.contains(target)) {
        return;
      }

      dragStartRef.current = {
        x: event.clientX,
        y: event.clientY,
        shift: event.shiftKey
      };
      setSelectionRect({
        x: event.clientX,
        y: event.clientY,
        w: 0,
        h: 0
      });
      event.preventDefault();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!dragStartRef.current) {
        return;
      }

      const nextRect = normalizeRect(dragStartRef.current.x, dragStartRef.current.y, event.clientX, event.clientY);
      setSelectionRect(nextRect);
      event.preventDefault();
    };

    const onPointerUp = (event: PointerEvent) => {
      const dragStart = dragStartRef.current;
      if (!dragStart) {
        return;
      }

      dragStartRef.current = null;

      const finalRect = normalizeRect(dragStart.x, dragStart.y, event.clientX, event.clientY);
      const isClick = finalRect.w < 4 && finalRect.h < 4;
      const nextIds = new Set<string>(dragStart.shift ? selectedIds : []);

      const blockElements = container.querySelectorAll<HTMLElement>("[data-block-id]");
      for (const element of blockElements) {
        const id = element.dataset.blockId;
        if (!id) {
          continue;
        }

        const rect = element.getBoundingClientRect();
        const blockRect: SelectionRect = { x: rect.left, y: rect.top, w: rect.width, h: rect.height };

        if (isClick) {
          continue;
        }

        if (rectsIntersect(blockRect, finalRect)) {
          nextIds.add(id);
        }
      }

      if (isClick) {
        const target = event.target instanceof Element ? event.target : null;
        const closest = target?.closest<HTMLElement>("[data-block-id]");
        const clickedId = closest?.dataset.blockId;
        if (clickedId && container.contains(closest)) {
          if (dragStart.shift && nextIds.has(clickedId)) {
            nextIds.delete(clickedId);
          } else {
            nextIds.add(clickedId);
          }
        }
        setSelectedIds(pruneAncestorSelections(nextIds, container));
        setSelectionRect(null);
        event.preventDefault();
        return;
      }

      setSelectedIds(pruneAncestorSelections(nextIds, container));
      setSelectionRect(null);
      event.preventDefault();
    };

    container.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);

    return () => {
      container.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [containerRef, isSelectingMode, selectedIds]);

  return {
    isSelectingMode,
    selectedIds,
    selectionRect,
    enterSelectingMode,
    exitSelectingMode,
    clearSelection
  };
}
