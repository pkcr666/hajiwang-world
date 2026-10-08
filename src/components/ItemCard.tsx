import type { Item } from '../types';
import { itemIcon } from '../assets/config';
import { bonusLines, RARITY_COLORS, RARITY_LABELS, SLOT_LABELS, WEAPON_TYPE_LABELS } from '../ui/labels';
import { Sprite } from './Sprite';

export function ItemCard({ item, count, onClick, onDelete, onTogglePool, selected }: {
  item: Item;
  count?: number;
  onClick?: () => void;
  onDelete?: () => void;
  onTogglePool?: (inPool: boolean) => void;
  selected?: boolean;
}) {
  const inPool = item.inPool !== false;
  return (
    <div
      className={`card item-card ${selected ? 'card-selected' : ''} ${onClick ? 'clickable' : ''}`}
      style={{ borderColor: RARITY_COLORS[item.rarity] }}
      onClick={onClick}
    >
      <Sprite className="item-icon" src={itemIcon(item.slot, item.icon)} alt={item.name} />
      <div className="item-main">
        <div className="item-name" style={{ color: RARITY_COLORS[item.rarity] }}>
          {item.name}
          {count !== undefined && count > 1 ? <span className="item-count">×{count}</span> : null}
        </div>
        <div className="item-sub">{RARITY_LABELS[item.rarity]} · {SLOT_LABELS[item.slot]}{item.weaponType ? ` · ${WEAPON_TYPE_LABELS[item.weaponType]}` : ''}{item.level ? ` · Lv.${item.level}` : ''}</div>
        <div className="item-bonus">{bonusLines(item).join('，') || item.desc}</div>
      </div>
      <div className="item-actions">
        {onTogglePool && (
          <button
            className={`btn-mini ${inPool ? 'btn-primary' : 'btn'}`}
            title={inPool ? '已在随机池中，点击移出' : '不在随机池中，点击加入'}
            onClick={(e) => { e.stopPropagation(); onTogglePool(!inPool); }}
          >
            {inPool ? '池' : '✕池'}
          </button>
        )}
        {item.custom && onDelete && (
          <button className="btn-danger btn-mini" onClick={(e) => { e.stopPropagation(); onDelete(); }}>删</button>
        )}
      </div>
    </div>
  );
}
