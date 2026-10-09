import pkg from '../../package.json';

export function Home({ go }: { go: (p: 'dungeons' | 'stages' | 'roster' | 'setup' | 'collection' | 'bestiary' | 'buffs' | 'relics' | 'eventLibrary' | 'forge' | 'aceLibrary' | 'onlineLobby' | 'workshop') => void }) {
  // 清除全部本地游戏数据（存档/图鉴/缩放/联机地址等）：怪物等数据更新后老存档会导致无法正常游戏
  const clearLocalData = () => {
    if (!window.confirm('确定清除所有本地游戏数据（存档、图鉴、设置）？\n此操作不可恢复，清除后将刷新页面。')) return;
    try {
      for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
    } catch { /* 存储不可用时忽略 */ }
    window.location.reload();
  };
  return (
    <div className="home">
      <h1 className="game-title">哈基汪世界</h1>
      <p className="game-sub">回合制对战 · 原型测试版</p>
      <div className="home-menu">
        <button className="menu-btn primary" onClick={() => go('dungeons')}>冒险启程</button>
        <button className="menu-btn" onClick={() => go('onlineLobby')}>联机探险（Beta）</button>
        <button className="menu-btn" onClick={() => go('workshop')}>创意工坊</button>
        <button className="menu-btn" onClick={() => go('roster')}>角色名册</button>
        <button className="menu-btn" onClick={() => go('forge')}>锻造炉</button>
        <button className="menu-btn" onClick={() => go('stages')}>关卡库</button>
        <button className="menu-btn" onClick={() => go('setup')}>对战测试</button>
        <button className="menu-btn" onClick={() => go('aceLibrary')}>王牌单位库</button>
        <button className="menu-btn" onClick={() => go('collection')}>藏品库</button>
        <button className="menu-btn" onClick={() => go('bestiary')}>怪物图鉴</button>
        <button className="menu-btn" onClick={() => go('buffs')}>BUFF 库</button>
        <button className="menu-btn" onClick={() => go('relics')}>遗物图鉴</button>
        <button className="menu-btn" onClick={() => go('eventLibrary')}>事件库</button>
      </div>
      <div className="home-corner">
        <span className="home-ver">V{pkg.version}</span>
        <button className="home-clear" onClick={clearLocalData}>清除缓存</button>
      </div>
    </div>
  );
}
