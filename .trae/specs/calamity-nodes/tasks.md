# 灾厄泰拉节点系统实现任务

## Task 1: 类型与数据结构扩展
**Priority:** high
**Dependencies:** none
**Status:** pending

- types.ts: `MapNodeKind` 新增 `'skirmish' | 'recruit' | 'plague'`
- types.ts: `NodeState` 新增 skirmish/recruit/plague 状态（含已使用标记、刷新次数等）
- types.ts: `PickReward` 新增强化石材料类型（复用 material）
- data/items.ts: 新增强化石材料 it_stone_rare/epic/legendary
- data/relics.ts: 新增遗物「痛苦之村的求救信」(每走一节点最大生命-2%)
- data/aceUnits.ts: 新建王牌单位数据（含雷鸟示例：HP500/攻120/MP100/防60/法抗30/速6-9，技能）

**Test Requirements:**
- rule: tsc 编译通过

---

## Task 2: 灾厄泰拉地图生成（5 层固定结构）
**Priority:** high
**Dependencies:** Task 1
**Status:** pending

- engine/mapgen.ts: 新增 `generateCalamityAct(floor, stages, rng)`，按精确列规则生成每层节点
- 一层（5列）：col1=1作战；col2/3=一列2个一列3个（3作战+2不期而遇，作战25%紧急）；col4=1招募；col5=1行商
- 二层（6列）：col1=1祭坛；col2=2作战；col3-5=每列3个共9个（4作战+1安全+3不期而遇+1招募，每横排≥1作战）；col6=BOSS
- 三层（7列）：col1=3个（作战或不期而遇）；col2-5=每列4个共16个（6作战+3不期而遇+2安全+1行商+1招募+1异界+1失与得+1狭路，每横排≥1作战，安全/行商每横排≤1）；col6=BOSS
- 四层（7列）：同三层结构，BOSS 为骷髅王/史莱姆之神
- 五层（8列）：col1=4个（2作战+2不期而遇）；col2-6=每列4个共20个（7作战+4不期而遇+2安全+2行商+1招募+2异界+1失与得+1狭路，约束同上）；col7=BOSS
- engine/run.ts: 新增 `startCalamityRun`，固定 5 层
- engine/mapgen.ts: poolOf 支持按 dungeonId 过滤（preWallCalamity）
- 关卡/怪物数据先用占位创建

**Test Requirements:**
- rule: startCalamityRun 生成 5 层，每层列数与节点种类计数符合规格
- rule: 一层 col1 为普通作战，col4 招募 col5 行商
- rule: 二层 col1 为祭坛，末列 BOSS 为世界吞噬者/克苏鲁之脑
- rule: 三/四层 16 节点分布正确，每横排至少 1 作战
- rule: 五层 20 节点分布正确，末列 BOSS 为肉山/戴维安

---

## Task 3: 作战掉落与火把系统（灾厄泰拉分支）
**Priority:** high
**Dependencies:** Task 1
**Status:** pending

- engine/run.ts: `buildBattleRewards` 按 dungeonId 分支
  - preWallCalamity: 藏品权重 40/30/20/8/2，遗物 20%+luk/2(普通) 或必掉(紧急/BOSS)，强化石必掉1个(60/30/10)
  - starterVillage: 保持原逻辑
- engine/run.ts: `rollTorchDrop` 按 dungeonId 分支（preWallCalamity: 15/30/100，上限6）
- engine/run.ts: 火把获取时截断至上限 6

**Test Requirements:**
- rule: preWallCalamity 作战奖励含强化石且品质分布正确
- rule: preWallCalamity 火把掉率 15/30/100，上限6
- rule: starterVillage 掉落与火把逻辑不变

---

## Task 4: 诡异行商灾厄泰拉规则
**Priority:** high
**Dependencies:** Task 1
**Status:** pending

- engine/nodes.ts: `rollMerchantShop` 按 dungeonId 分支
  - preWallCalamity: 4藏品+4遗物+2药水+2道具，价格 2000/3000/5000/7000/10000
  - 新增道具槽位（无品质，固定价）
- engine/nodes.ts: 刷新消耗火把 1/2/3 递增，首次免费
- pages/RunMerchant.tsx: 适配新商品构成与刷新火把消耗

**Test Requirements:**
- rule: preWallCalamity 行商商品为 4+4+2+2，价格正确
- rule: 刷新消耗 1/2/3 火把递增

---

## Task 5: 失与得与安全角落改造
**Priority:** medium
**Dependencies:** Task 1
**Status:** pending

- engine/nodes.ts: `executeTrade` 支持交换 2 次（NodeState trade 加 exchangeCount）
- engine/nodes.ts: `restHealPercent` 灾厄泰拉公式：`20 + (1D50 + 意志) * 0.5`
- pages/RunRest.tsx: 灾厄泰拉增加「复活死亡单位」选项

**Test Requirements:**
- rule: 失与得可交换 2 次
- rule: 安全角落恢复公式正确，可复活死亡单位

---

## Task 6: 狭路相逢节点
**Priority:** high
**Dependencies:** Task 1, Task 2
**Status:** pending

- engine/nodes.ts: `rollSkirmishTiers` 从怪物库抽取 3 档怪物（灾厄泰拉分类，属性提升）
- engine/nodes.ts: `skirmishRewards(tier)` 返回对应奖励
- engine/run.ts: 狭路逢战斗后恢复 HP/MP 至进入前快照（保存进入前 hpMp）
- pages/RunSkirmish.tsx: 选档→战斗→领奖/离开
- 战斗复用现有 Battle.tsx + BattleSetup

**Test Requirements:**
- rule: 3 档奖励正确（强化石数量+遗物+藏品）
- rule: 战斗后 HP/MP 恢复，道具/一次性技能不恢复

---

## Task 7: 王牌招募节点
**Priority:** high
**Dependencies:** Task 1, Task 2
**Status:** pending

- engine/nodes.ts: `rollRecruitCandidates(run, save, rng)` 从名册+王牌单位中选 3 名
- engine/nodes.ts: `recruitMember(run, charId/aceId)` 加入队伍（最多3人）
- 名册角色本局仅可选 1 次（RunState 加 recruitedOwnChars 集合）
- 刷新消耗 1/2/3 火把，首次免费
- pages/RunRecruit.tsx: 3 选 1 卡片 + 刷新按钮
- 王牌单位战斗时作为 Combatant 生成（固定属性，简化技能）

**Test Requirements:**
- rule: 名册不足时出王牌单位，已有2名自有角色时只出王牌
- rule: 队伍最多 3 人
- rule: 刷新消耗 1/2/3 火把递增

---

## Task 8: 异界来客离开选项
**Priority:** medium
**Dependencies:** Task 2
**Status:** pending

- pages/RunMap.tsx: 异界来客弹窗增加「离开」按钮（不消耗火把，节点标记已清理）
- engine/run.ts: enterSublayer 消耗 1 火把；离开节点不消耗

**Test Requirements:**
- rule: 异界来客可选消耗火把进子层或直接离开

---

## Task 9: 祭坛节点（二层首列）
**Priority:** high
**Dependencies:** Task 1, Task 2
**Status:** pending

- data/relics.ts: 新增 rl_altar_crimson（猩红祭坛，敌方每回合恢复5%最大生命）、rl_altar_corruption（腐化祭坛，敌方每回合随机减我方5攻或5防）
- engine/nodes.ts: `resolveAltar(choice)` 处理 4 种选择（猩红/腐化/都要/放弃）
- engine/battle.ts: 祭坛遗物效果在敌方行动时触发
- pages/RunAltar.tsx: 4 选 1 祭坛选择界面

**Test Requirements:**
- rule: 选择猩红/腐化获得对应遗物，「我都要」获得两个，「跑路」不获得
- rule: 猩红祭坛使敌方每行动恢复 5% 最大生命
- rule: 腐化祭坛使敌方每行动随机减我方单位 5 攻或 5 防

---

## Task 10: 瘟疫之源节点（暂缓，6 层后实现）
**Priority:** low
**Dependencies:** Task 1, Task 2
**Status:** deferred

- engine/nodes.ts: 瘟疫之源状态机（未探索→探索中→已完成→瘟疫蔓延）
- 首次进入：消耗1火把→当层紧急作战；或离开（节点保留）
- 完成后再次进入：紧急作战-瘟疫蔓延，胜利获得遗物「痛苦之村的求救信」
- 遗物效果：每走一个节点最大生命 -2%（在节点清理时触发）
- pages/RunPlague.tsx: 探索/离开/战斗/遗物展示

**Test Requirements:**
- rule: 首次进入可选探索或离开，离开后节点保留
- rule: 完成后再次进入触发瘟疫蔓延战斗，掉落遗物
- rule: 遗物效果每走一节点最大生命-2%

---

## Task 11: RunMap 新节点渲染与 RunPick 新奖励
**Priority:** high
**Dependencies:** Task 1, Task 2
**Status:** pending

- pages/RunMap.tsx: 渲染 skirmish/recruit/plague/altar 节点图标与标签
- pages/RunMap.tsx: 节点点击路由到对应页面
- pages/RunPick.tsx: 支持强化石材料展示
- pages/RunEvent.tsx: 复用现有事件（dungeon 兼容）

**Test Requirements:**
- rule: 新节点类型在地图上正确渲染
- rule: 强化石奖励在拾取界面正确显示

---

## Task 11: 编译验证与回归测试
**Priority:** high
**Dependencies:** all
**Status:** pending

- 运行 `tsc --noEmit` 确保无错误
- 运行现有单测确保新手村逻辑未被破坏
- 手动启动 dev server 验证灾厄泰拉各节点可正常进入

**Test Requirements:**
- rule: tsc 编译通过
- rule: 现有 run/drops/mapgen 单测通过
