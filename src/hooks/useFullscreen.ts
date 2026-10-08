import { useCallback, useEffect, useState } from 'react';

/**
 * 全屏切换：进入/退出浏览器全屏，并同步 fullscreenchange 状态。
 * 兼容 webkit 前缀（iOS Safari 旧实现）。
 * 注意：iOS Safari 只允许用户主动点击触发全屏，属浏览器安全策略，无法自动进入。
 */
export function useFullscreen() {
  const [isFull, setIsFull] = useState(false);

  const toggleFull = useCallback(async () => {
    try {
      const doc = document as Document & {
        webkitExitFullscreen?: () => Promise<void>;
        webkitFullscreenElement?: Element | null;
      };
      const el = document.documentElement as HTMLElement & {
        webkitRequestFullscreen?: () => Promise<void>;
      };
      if (doc.fullscreenElement || doc.webkitFullscreenElement) {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (doc.webkitExitFullscreen) {
          await doc.webkitExitFullscreen();
        }
      } else {
        if (el.requestFullscreen) {
          await el.requestFullscreen();
        } else if (el.webkitRequestFullscreen) {
          await el.webkitRequestFullscreen();
        }
      }
    } catch (err) {
      console.warn('全屏切换失败', err);
    }
  }, []);

  useEffect(() => {
    const onChange = () => setIsFull(!!(document.fullscreenElement || (document as Document & { webkitFullscreenElement?: Element | null }).webkitFullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  return { isFull, toggleFull };
}
