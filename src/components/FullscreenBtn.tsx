import type { CSSProperties } from 'react';
import { Capacitor } from '@capacitor/core';
import { useFullscreen } from '../hooks/useFullscreen';
import { useDevice } from '../hooks/useDevice';

/**
 * 全屏按钮：全局悬浮右下角，PC 与手机端均可使用。
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
    right: isMobile ? 12 : 16,
    bottom: isMobile ? 20 : 16,
    zIndex: 99999,
    padding: isMobile ? '12px 18px' : '8px 14px',
    fontSize: isMobile ? 16 : 14,
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,0.2)',
    background: 'rgba(15,15,35,0.8)',
    color: '#fff',
    backdropFilter: 'blur(4px)',
    WebkitBackdropFilter: 'blur(4px)',
    cursor: 'pointer',
    boxShadow: '0 2px 10px rgba(0,0,0,0.4)',
    touchAction: 'manipulation',
    userSelect: 'none',
    lineHeight: 1.2,
  };

  return (
    <button type="button" style={style} onClick={toggleFull} title={isFull ? '退出全屏' : '进入全屏'}>
      {isFull ? '退出全屏' : '全屏'}
    </button>
  );
}
