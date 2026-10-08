import type { ReactNode } from 'react';

export function Modal({ title, onClose, children, wide, xwide }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  xwide?: boolean;
}) {
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className={`modal ${wide ? 'modal-wide' : ''} ${xwide ? 'modal-x' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn-icon" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
