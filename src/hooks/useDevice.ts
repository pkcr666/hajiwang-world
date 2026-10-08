import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';

export type LayoutMode = 'mobile' | 'desktop';

/**
 * 设备检测：判断当前运行环境应使用「手机端横屏布局」还是「桌面端布局」。
 *
 * 判定规则：
 * 1. Capacitor 原生环境（Android/iOS WebView）→ 一律 mobile
 * 2. 浏览器环境：UA 含移动端标识，或（触摸屏 + 视口短边 < 768px）→ mobile
 * 3. 其余 → desktop
 *
 * 会监听窗口尺寸变化（旋转/分屏），自动切换布局模式。
 */
export function useDevice(): LayoutMode {
  const detect = (): LayoutMode => {
    if (typeof window === 'undefined') return 'desktop';
    // Capacitor 原生壳：强制手机端布局
    if (Capacitor.isNativePlatform()) return 'mobile';
    const ua = navigator.userAgent || '';
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const shortSide = Math.min(window.innerWidth, window.innerHeight);
    const isMobileUA = /Android|iPhone|iPad|iPod|Mobile|HarmonyOS|Opera Mini/i.test(ua);
    if (isMobileUA) return 'mobile';
    if (isTouch && shortSide < 768) return 'mobile';
    return 'desktop';
  };

  const [mode, setMode] = useState<LayoutMode>(detect);

  useEffect(() => {
    const onResize = () => setMode(detect());
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  return mode;
}
