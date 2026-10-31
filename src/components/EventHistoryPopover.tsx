import React, { useEffect, useMemo, useRef, useState } from 'react';
import { History, Redo2, RotateCcw, Undo2 } from 'lucide-react';
import { useEventHistoryOptional } from '../hooks/useEventHistory';
import { formatHistoryTimestamp } from '../utils/eventHistoryDiff';
import { TopBarTooltip } from './common/TopBarTooltip';

interface EventHistoryPopoverProps {
  externalOpenRequest?: number;
}

/**
 * 상단 바 미니멀 프로스티드 글래스 '일정 수정 히스토리' 스택 팝오버
 * - 직전 변경 1단계 되돌리기(⌘Z) / 다시 실행(⌘⇧Z)
 * - 과거 특정 단계 클릭 시 해당 시점까지 일괄 다단계 롤백 지원
 */
export const EventHistoryPopover: React.FC<EventHistoryPopoverProps> = ({
  externalOpenRequest,
}) => {
  const historyApi = useEventHistoryOptional();
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (externalOpenRequest && externalOpenRequest > 0) {
      setIsOpen(true);
    }
  }, [externalOpenRequest]);

  useEffect(() => {
    if (!isOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleEsc);
    };
  }, [isOpen]);

  const reversedPast = useMemo(
    () => (historyApi ? [...historyApi.past].reverse() : []),
    [historyApi]
  );

  if (!historyApi) return null;

  const { past, future, canUndo, canRedo, undoStep, redoStep, revertToEntry, clearHistory } =
    historyApi;
  const hasAnyHistory = past.length > 0 || future.length > 0;
  const latestRedoEntry = future.length > 0 ? future[future.length - 1] : null;

  return (
    <div ref={popoverRef} className="relative flex items-center shrink-0">
      <TopBarTooltip
        label={canUndo ? `수정 히스토리 · ${past.length}단계` : '수정 히스토리'}
        shortcut="⌘Z"
        align="right"
        disabled={isOpen}
      >
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-label="일정 수정 히스토리"
          aria-expanded={isOpen}
          className={`relative h-7 w-7 rounded-lg flex items-center justify-center transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/25 ${
            isOpen
              ? 'bg-white/[0.09] text-white'
              : canUndo
              ? 'text-neutral-300 hover:text-white hover:bg-white/[0.06]'
              : 'text-neutral-500 hover:text-neutral-200 hover:bg-white/[0.06]'
          }`}
        >
          <History className="w-[15px] h-[15px]" strokeWidth={1.65} />
          {canUndo && !isOpen && (
            <span
              aria-hidden="true"
              className="absolute top-1.5 right-1.5 w-1 h-1 rounded-full bg-white/75"
            />
          )}
        </button>
      </TopBarTooltip>

      {isOpen && (
        <div className="luxury-glass-border absolute right-0 top-full mt-2 w-80 rounded-xl bg-gradient-to-b from-[#181c27]/84 via-[#11141d]/82 to-[#0c0e15]/90 backdrop-blur-xl backdrop-saturate-150 shadow-[0_24px_56px_-12px_rgba(0,0,0,0.78),0_8px_20px_-4px_rgba(0,0,0,0.5),inset_0_1px_0_0_rgba(255,255,255,0.05)] z-50 overflow-hidden select-none">
          {/* 상단 헤더 */}
          <div className="px-3 py-2 border-b border-white/[0.06] flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs min-w-0">
              <span className="font-medium text-white tracking-tight whitespace-nowrap">
                수정 히스토리
              </span>
              {past.length > 0 && (
                <>
                  <span aria-hidden="true" className="text-neutral-600">
                    ·
                  </span>
                  <span className="font-mono text-[11px] text-neutral-400 tabular-nums whitespace-nowrap">
                    {past.length}단계
                  </span>
                </>
              )}
            </div>

            <div className="flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                disabled={!canUndo}
                onClick={() => undoStep()}
                aria-label="한 단계 되돌리기"
                title="한 단계 되돌리기 (⌘Z)"
                className="h-6 w-6 rounded-md flex items-center justify-center text-neutral-300 hover:text-white hover:bg-white/[0.08] disabled:opacity-30 disabled:hover:bg-transparent transition-colors cursor-pointer disabled:cursor-default"
              >
                <Undo2 className="w-3.5 h-3.5" strokeWidth={1.7} />
              </button>
              <button
                type="button"
                disabled={!canRedo}
                onClick={() => redoStep()}
                aria-label="다시 실행"
                title="다시 실행 (⌘⇧Z)"
                className="h-6 w-6 rounded-md flex items-center justify-center text-neutral-300 hover:text-white hover:bg-white/[0.08] disabled:opacity-30 disabled:hover:bg-transparent transition-colors cursor-pointer disabled:cursor-default"
              >
                <Redo2 className="w-3.5 h-3.5" strokeWidth={1.7} />
              </button>
              {hasAnyHistory && (
                <button
                  type="button"
                  onClick={() => clearHistory()}
                  className="ml-0.5 h-6 px-1.5 rounded-md text-[10.5px] text-neutral-500 hover:text-neutral-200 hover:bg-white/[0.06] transition-colors cursor-pointer whitespace-nowrap"
                >
                  비우기
                </button>
              )}
            </div>
          </div>

          {/* 되돌린 변경 다시 실행 바 */}
          {latestRedoEntry && (
            <div className="px-3 py-1.5 border-b border-white/[0.05] bg-white/[0.025] flex items-center justify-between gap-2 text-[11px]">
              <div className="min-w-0 flex items-center gap-1.5 text-neutral-400 truncate">
                <span className="shrink-0 tabular-nums">되돌림 ({future.length})</span>
                <span aria-hidden="true" className="text-neutral-600 shrink-0">
                  ·
                </span>
                <span className="truncate text-neutral-300">{latestRedoEntry.label}</span>
              </div>
              <button
                type="button"
                onClick={() => redoStep()}
                className="h-5 px-2 rounded bg-white/[0.08] hover:bg-white/[0.14] text-[10.5px] text-white font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                다시 적용
              </button>
            </div>
          )}

          {/* 스택 목록 */}
          {reversedPast.length === 0 ? (
            <div className="py-7 px-4 text-center">
              <p className="text-xs text-neutral-500 tracking-tight">
                기록된 일정 변경 내역이 없습니다
              </p>
            </div>
          ) : (
            <div className="max-h-72 overflow-y-auto p-1.5 space-y-0.5">
              {reversedPast.map((entry, idx) => {
                const stepsToUndo = idx + 1;
                return (
                  <div
                    key={entry.id}
                    className="group px-2.5 py-2 rounded-lg hover:bg-white/[0.055] flex items-center justify-between gap-2.5 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-xs text-neutral-100 font-medium truncate">
                          {entry.label}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-neutral-500 truncate">
                        <span className="font-mono tabular-nums shrink-0">
                          {formatHistoryTimestamp(entry.timestamp)}
                        </span>
                        {entry.detail && (
                          <>
                            <span aria-hidden="true" className="text-neutral-600 shrink-0">
                              ·
                            </span>
                            <span className="truncate text-neutral-400">{entry.detail}</span>
                          </>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => revertToEntry(entry.id)}
                      className="h-6 px-2 rounded-md bg-white/[0.05] hover:bg-white/[0.13] border border-white/[0.08] text-[10.5px] text-neutral-200 hover:text-white inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <RotateCcw className="w-2.5 h-2.5 shrink-0" strokeWidth={1.8} />
                      <span>{stepsToUndo === 1 ? '되돌리기' : `${stepsToUndo}단계 복원`}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* 하단 단축키 안내 헤어라인 */}
          <div className="px-3 py-1.5 border-t border-white/[0.05] bg-black/20 flex items-center justify-between text-[10px] font-mono text-neutral-500 tabular-nums">
            <span>⌘Z 단계별 되돌리기</span>
            <span>⌘⇧Z 다시 실행</span>
          </div>
        </div>
      )}
    </div>
  );
};
