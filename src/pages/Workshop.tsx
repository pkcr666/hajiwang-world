// 创意工坊：哈基汪世界内的其他游戏库（各游戏独立运行、独立端口，联机均走玩家自己的服务器）
const SP_WEB = 'http://115.159.216.102:3003';
const SP_APK = 'http://115.159.216.102:3010/stronghold-protocol.apk';

export function Workshop({ onBack }: { onBack: () => void }) {
  return (
    <div className="home workshop-page">
      <h1 className="game-title">创意工坊</h1>
      <p className="game-sub">哈基汪世界的游戏库 · 各游戏独立运行，仅学习交流使用</p>
      <div className="workshop-grid">
        <div className="workshop-card">
          <span className="workshop-badge live">LIVE</span>
          <h2>明日方舟 · 卫戍协议</h2>
          <p>
            开源同人游戏（Stronghold Protocol），已部署在你的服务器。<br />
            网页版与安卓 APK 的联机均只通过你的服务器（115.159.216.102:3003）。
          </p>
          <div className="workshop-actions">
            <button className="menu-btn primary" onClick={() => window.open(SP_WEB, '_blank')}>
              开始游玩（网页版）
            </button>
            <button className="menu-btn" onClick={() => window.open(SP_APK, '_blank')}>
              下载安卓 APK（约 246MB）
            </button>
          </div>
        </div>
        <div className="workshop-card">
          <span className="workshop-badge soon">筹备中</span>
          <h2>杀戮尖塔 2</h2>
          <p>创意工坊小游戏正在陆续接入中，敬请期待。</p>
        </div>
      </div>
      <div className="workshop-actions">
        <button className="menu-btn" onClick={onBack}>← 返回主菜单</button>
      </div>
      <p className="workshop-note">注：创意工坊内所有游戏均为学习交流用途，联机仅通过你自己的服务器。</p>
    </div>
  );
}
