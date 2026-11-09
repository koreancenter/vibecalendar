import React from 'react';
import { AlertTriangle, ArrowUpRight, Loader2, Trash2, X } from 'lucide-react';
import { OutboundMutationPlanItem } from '../../services/sync/syncEngine';
import { HelpTooltip } from '../common/HelpTooltip';

interface OutboundSyncConfirmModalProps {
  plan: OutboundMutationPlanItem[] | null;
  isExecuting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const PROVIDER_LABELS: Record<OutboundMutationPlanItem['provider'], string> = {
  google: 'Google Calendar',
  microsoft: 'Microsoft Outlook',
  caldav: 'CalDAV',
};

export const OutboundSyncConfirmModal: React.FC<OutboundSyncConfirmModalProps> = ({
  plan,
  isExecuting,
  onConfirm,
  onCancel,
}) => {
  if (!plan || plan.length === 0) return null;

  const creates = plan.filter((i) => i.op === 'create');
  const updates = plan.filter((i) => i.op === 'update');
  const deletes = plan.filter((i) => i.op === 'delete');

  return (
    <div
      className="fixed inset-0 z-[85] flex items-center justify-center bg-black/75 backdrop-blur-xs px-4"
      role="dialog"
      aria-modal="true"
      aria-label="외부 클라우드 캘린더 변경 반영 확인"
      onClick={() => {
        if (!isExecuting) onCancel();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="luxury-glass-border w-full max-w-lg rounded-xl bg-gradient-to-b from-[#181c27]/95 via-[#12151f]/95 to-[#0c0e15]/98 backdrop-blur-xl shadow-[0_24px_64px_-12px_rgba(0,0,0,0.85)] border border-white/[0.08] overflow-hidden text-neutral-200 select-none"
      >
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0" />
            <h3 className="text-sm font-semibold text-white tracking-tight truncate">
              외부 클라우드 캘린더 변경 반영 확인
            </h3>
            <HelpTooltip
              title="아웃바운드 동기화 승인"
              content="양방향 하이브리드 동기화 정책에 따라 로컬 볼트에서 변경된 일정을 Google, Microsoft, CalDAV 등 원격 클라우드로 안전하게 전송합니다."
              align="left"
              placement="bottom"
            />
          </div>
          <button
            type="button"
            disabled={isExecuting}
            onClick={onCancel}
            aria-label="닫기"
            className="h-7 w-7 rounded-lg flex items-center justify-center text-neutral-500 hover:text-white hover:bg-white/[0.06] cursor-pointer disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-xs text-neutral-300 leading-relaxed">
            양방향 하이브리드 동기화가 활성화된 외부 캘린더에 아래 로컬 볼트 변경사항을 반영합니다.
            승인하기 전까지 원격 계정의 데이터는 변경되지 않습니다.
          </p>

          <div className="flex items-center gap-2 text-xs text-neutral-400 tabular-nums">
            <span>총 {plan.length}건</span>
            <span aria-hidden="true">·</span>
            <span>신규 등록 {creates.length}건</span>
            <span aria-hidden="true">·</span>
            <span>수정 {updates.length}건</span>
            <span aria-hidden="true">·</span>
            <span className={deletes.length > 0 ? 'text-rose-300' : ''}>
              원격 삭제 {deletes.length}건
            </span>
          </div>

          <div className="max-h-60 overflow-y-auto rounded-lg border border-white/[0.06] bg-[#0c0e14]/80 divide-y divide-white/[0.05]">
            {plan.map((item) => (
              <div
                key={item.id}
                className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[11px] text-neutral-400 truncate">
                    <span>{PROVIDER_LABELS[item.provider]}</span>
                    <span aria-hidden="true">·</span>
                    <span className="truncate">{item.calendarName}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">{item.eventDate}</span>
                  </div>
                  <div className="mt-0.5 text-neutral-100 font-medium truncate">
                    {item.eventTitle}
                  </div>
                </div>

                <span
                  className={`text-[11px] font-medium shrink-0 whitespace-nowrap flex items-center gap-1 ${
                    item.op === 'delete'
                      ? 'text-rose-300'
                      : item.op === 'create'
                      ? 'text-emerald-300'
                      : 'text-sky-300'
                  }`}
                >
                  {item.op === 'delete' ? (
                    <>
                      <Trash2 className="w-3 h-3" />
                      <span>원격 삭제</span>
                    </>
                  ) : item.op === 'create' ? (
                    <>
                      <ArrowUpRight className="w-3 h-3" />
                      <span>신규 생성</span>
                    </>
                  ) : (
                    <span>일정 수정</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-white/[0.06] bg-white/[0.015] flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={isExecuting}
            onClick={onCancel}
            className="h-9 px-4 rounded-lg border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] text-xs font-medium text-neutral-300 cursor-pointer whitespace-nowrap disabled:opacity-50"
          >
            취소 (로컬만 유지)
          </button>
          <button
            type="button"
            disabled={isExecuting}
            onClick={onConfirm}
            className="h-9 px-4 rounded-lg bg-white text-[#0c0e14] hover:bg-neutral-200 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap disabled:opacity-50"
          >
            {isExecuting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>원격 반영 중...</span>
              </>
            ) : (
              <span>승인 및 원격 반영 ({plan.length}건)</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
