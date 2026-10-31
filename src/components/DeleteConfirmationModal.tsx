import React, { useEffect } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';

interface DeleteConfirmationModalProps {
  isOpen: boolean;
  title: string;
  itemName: string;
  itemType?: '일정' | '프로젝트';
  isRecurringSeries?: boolean;
  occurrenceDateLabel?: string;
  onConfirmSingleOccurrence?: () => void;
  onConfirm: () => void;
  onClose: () => void;
}

export const DeleteConfirmationModal: React.FC<DeleteConfirmationModalProps> = ({
  isOpen,
  title,
  itemName,
  itemType = '일정',
  isRecurringSeries = false,
  occurrenceDateLabel,
  onConfirmSingleOccurrence,
  onConfirm,
  onClose,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-[#161821] border border-white/10 rounded-2xl p-5 shadow-2xl space-y-4"
      >
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
          <div className="flex items-center gap-2 text-rose-400 font-semibold text-sm">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{title || `${itemType} 삭제 확인`}</span>
          </div>
        </div>

        <div className="space-y-2.5 text-sm text-neutral-300">
          <p>
            <span className="font-semibold text-white">&apos;{itemName}&apos;</span> {itemType}을(를)
            삭제하시겠습니까?
          </p>
          <p className="text-xs text-neutral-400 leading-relaxed">
            {itemType === '프로젝트'
              ? '프로젝트에 연결된 일정은 삭제되지 않으며 일반 일정으로 전환됩니다.'
              : isRecurringSeries && onConfirmSingleOccurrence
              ? `${
                  occurrenceDateLabel ? `${occurrenceDateLabel} 회차만` : '선택한 회차만'
                } 제외하거나 전체 반복 시리즈를 일괄 삭제할 수 있습니다. 하단 알림에서 즉시 실행 취소 가능합니다.`
              : '삭제 후 하단 알림에서 즉시 실행 취소할 수 있습니다.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-white/[0.08]">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-neutral-300 hover:bg-white/10 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            취소
          </button>
          {isRecurringSeries && onConfirmSingleOccurrence && (
            <button
              type="button"
              onClick={() => {
                onConfirmSingleOccurrence();
                onClose();
              }}
              className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-white/[0.09] hover:bg-white/[0.15] border border-white/[0.12] text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              이 회차만 삭제
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className="px-4 py-1.5 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{isRecurringSeries && onConfirmSingleOccurrence ? '전체 반복 삭제' : '삭제 확인'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
