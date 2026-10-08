export function Home({ go }: { go: (p: 'dungeons' | 'stages' | 'roster' | 'setup' | 'collection' | 'bestiary' | 'buffs' | 'relics' | 'eventLibrary' | 'forge' | 'aceLibrary' | 'onlineLobby') => void }) {
  return (
    <div className="home">
      <h1 className="game-title">哈基汪世界</h1>
      <p className="game-sub">回合制对战 · 原型测试版</p>
      <div className="home-menu">
        <button className="menu-btn primary" onClick={() => go('dungeons')}>冒险启程</button>
        <button className="menu-btn" onClick={() => go('onlineLobby')}>联机探险（Beta）</button>
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
    </div>
  );
}
