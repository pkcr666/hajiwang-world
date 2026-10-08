import type { AceUnit, Character, Party } from '../types';
import { ACE_UNIT_MAP } from '../data/aceUnits';

// memberIds 规范化：去重、队长固定首位；deployedIds 同步裁剪为 memberIds 子集且最多3名
export function normalizeParty(leaderId: string, memberIds: string[]): Party {
  const rest = memberIds.filter((id) => id !== leaderId);
  const ids = [leaderId, ...rest];
  const deployed = ids.slice(0, 3);
  return { leaderId, memberIds: ids, deployedIds: deployed };
}

export const partyMembers = (party: Party, chars: (Character | null)[]): Character[] =>
  party.memberIds
    .map((id) => chars.find((c) => c?.id === id))
    .filter((c): c is Character => !!c);

// 上场成员：deployedIds（裁剪到 memberIds 内、最多3），缺省取 memberIds 前3
export function deployedMemberIds(party: Party): string[] {
  const set = new Set(party.memberIds);
  const deployed = (party.deployedIds ?? []).filter((id) => set.has(id));
  if (deployed.length > 0) return deployed.slice(0, 3);
  return party.memberIds.slice(0, 3);
}

export const deployedMembers = (party: Party, chars: (Character | null)[]): Character[] =>
  deployedMemberIds(party)
    .map((id) => chars.find((c) => c?.id === id))
    .filter((c): c is Character => !!c);

// 统一队伍成员条目：自有角色 + 王牌单位（按 memberIds 顺序）
export type PartyMemberEntry =
  | { kind: 'char'; id: string; name: string; data: Character }
  | { kind: 'ace'; id: string; name: string; data: AceUnit };

export function partyEntries(party: Party, chars: (Character | null)[]): PartyMemberEntry[] {
  return party.memberIds
    .map((id) => {
      const ch = chars.find((c) => c?.id === id);
      if (ch) return { kind: 'char' as const, id: ch.id, name: ch.name, data: ch };
      const ace = ACE_UNIT_MAP[id];
      if (ace) return { kind: 'ace' as const, id: ace.id, name: ace.name, data: ace };
      return null;
    })
    .filter((e): e is PartyMemberEntry => !!e);
}

// 进本时成员个人哈哈币全部汇入共享币池
export const poolCoins = (members: Character[]): number =>
  members.reduce((sum, m) => sum + Math.max(0, m.coins ?? 0), 0);

// 剩余哈哈币人均平分，除不尽的余数归队长
export function splitCoins(total: number, memberCount: number): { each: number; leaderExtra: number } {
  if (memberCount <= 0) return { each: 0, leaderExtra: 0 };
  const safe = Math.max(0, Math.floor(total));
  return { each: Math.floor(safe / memberCount), leaderExtra: safe % memberCount };
}

// 编队合法性：队长存在且在成员中、成员 1~maxParty、无重复、角色均存在
export function validateParty(
  party: Party | null | undefined,
  chars: (Character | null)[],
  maxParty: number,
): string | null {
  if (!party) return '尚未编队';
  if (party.memberIds.length < 1) return '请至少选择 1 名队员';
  if (!party.leaderId || !party.memberIds.includes(party.leaderId)) return '队长必须在编队中';
  if (new Set(party.memberIds).size !== party.memberIds.length) return '编队中有重复成员';
  if (party.memberIds.length > maxParty) return `该副本最多 ${maxParty} 人出战`;
  const all = chars.filter((c): c is Character => !!c).map((c) => c.id);
  if (party.memberIds.some((id) => !all.includes(id))) return '编队成员不存在';
  return null;
}
