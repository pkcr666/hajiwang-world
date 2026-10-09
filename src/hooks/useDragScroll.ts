import { useEffect, useRef } from 'react';

/**
 * 横向拖拽滚动：挂到 overflow-x 滚动容器上。
 *
 * 交互：
 * - 桌面端（鼠标/触控笔）：在容器上按住左键左右拖动即可横向滚动；
 *   纵向滚轮输入也会映射为横向滚动。
 * - 移动端（触摸）：不拦截事件，完全使用 WebView 原生触摸横滑（含惯性）。
 *
 * 防误触：拖动位移超过阈值（6px）后判定为拖拽，
 * 拖拽结束产生的 click 会被捕获阶段拦截，不会误触发技能/道具按钮。
 */
export function useDragScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let down = false;
    let dragged = false;
    let pointerId: number | null = null;
    let startX = 0;
    let startLeft = 0;

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return; // 触摸交给原生滚动
      down = true;
      dragged = false;
      pointerId = e.pointerId;
      startX = e.clientX;
      startLeft = el.scrollLeft;
      try { el.setPointerCapture(e.pointerId); } catch { /* 某些环境不支持时忽略 */ }
    };

    const onMove = (e: PointerEvent) => {
      if (!down || e.pointerId !== pointerId) return;
      const dx = e.clientX - startX;
      if (!dragged && Math.abs(dx) > 6) {
        dragged = true;
        el.classList.add('dragging');
      }
      if (dragged) {
        el.scrollLeft = startLeft - dx;
        e.preventDefault();
      }
    };

    const finish = (e: PointerEvent) => {
      if (pointerId !== null && e.pointerId !== pointerId) return;
      down = false;
      pointerId = null;
      el.classList.remove('dragging');
      // dragged 标志保留：若随后派发 click，由 onClick 拦截；下次 pointerdown 会重置
    };

    // 拖拽后的 click：捕获阶段拦截，避免误点技能
    const onClick = (e: MouseEvent) => {
      if (dragged) {
        e.stopPropagation();
        e.preventDefault();
        dragged = false;
      }
    };

    // 纵向滚轮 → 横向滚动（仅当容器存在对应方向的滚动空间时接管，避免阻断页面滚动）
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const max = el.scrollWidth - el.clientWidth;
      if ((e.deltaY > 0 && el.scrollLeft < max - 1) || (e.deltaY < 0 && el.scrollLeft > 0)) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);
    el.addEventListener('click', onClick, true);
    el.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', finish);
      el.removeEventListener('pointercancel', finish);
      el.removeEventListener('click', onClick, true);
      el.removeEventListener('wheel', onWheel);
    };
  }, []);

  return ref;
}
