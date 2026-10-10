import type { CSSProperties } from 'react';
import { Capacitor } from '@capacitor/core';
import { useFullscreen } from '../hooks/useFullscreen';
import { useDevice } from '../hooks/useDevice';

/**
 * 全屏按钮：全局悬浮右上角纯图标，PC 与手机端均可使用。
 * 移动端增大点击热区；点击进入/退出浏览器全屏。
 *
 * 原生壳（Android/iOS APK）：应用默认即为沉浸式全屏，无需浏览器全屏按钮，
 * 故在原生环境下不渲染，避免「点全屏无变化」的误导。
 */
export default function FullscreenBtn() {
  const { isFull, toggleFull } = useFullscreen();
  const layout = useDevice();
  const isMobile = layout === 'mobile';

  if (Capacitor.isNativePlatform()) return null;

  const style: CSSProperties = {
    position: 'fixed',
    top: isMobile ? 10 : 12,
    right: isMobile ? 32 : 38, /* 左移：离右缘远一点，避免贴边压住主界面内容 */
    zIndex: 99999,
    width: isMobile ? 36 : 30,
    height: isMobile ? 36 : 30,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.25)',
    background: 'rgba(15,15,35,0.75)',
    color: '#fff',
    backdropFilter: 'blur(4px)',
    WebkitBackdropFilter: 'blur(4px)',
    cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
    touchAction: 'manipulation',
    userSelect: 'none',
    padding: 0,
    lineHeight: 1,
  };

  const iconProps = {
    width: isMobile ? 20 : 17,
    height: isMobile ? 20 : 17,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  return (
    <button type="button" style={style} onClick={toggleFull} title={isFull ? '退出全屏' : '进入全屏'} aria-label={isFull ? '退出全屏' : '进入全屏'}>
      {isFull ? (
        <svg {...iconProps}><path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" /></svg>
      ) : (
        <svg {...iconProps}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
      )}
    </button>
  );
}
