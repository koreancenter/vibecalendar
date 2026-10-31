import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ArrowLeftRight, Check, Globe2, RotateCcw, Search, X } from 'lucide-react';
import {
  FormattedZoneClock,
  GLOBAL_EVENT_TIMEZONES,
  TimeZoneOption,
  formatClockInTimeZone,
  formatHourDiffShort,
} from '../shared/timeZoneUtils';
import { TopBarTooltip } from './common/TopBarTooltip';

interface TimeZoneControlProps {
  now?: Date;
  viewerMeta: TimeZoneOption;
  viewerClock: FormattedZoneClock;
  secondaryMeta?: TimeZoneOption | null;
  secondaryClock?: FormattedZoneClock | null;
  secondaryDiffLabel?: string;
  isManualPrimary?: boolean;
  onSelectSecondaryTimeZone?: (tz: string | null) => void;
  onSelectPrimaryTimeZone?: (tz: string | null) => void;
  onResetPrimaryToSystem?: () => void;
  onSwapTimeZones?: () => void;
}

/**
 * 상단 바 로컬·글로벌 듀얼 타임존 클록 및 빠른 시간대 전환 팝오버
 */
export const TimeZoneControl: React.FC<TimeZoneControlProps> = ({
  now,
  viewerMeta,
  viewerClock,
  secondaryMeta = null,
  secondaryClock = null,
  secondaryDiffLabel = '',
  isManualPrimary = false,
  onSelectSecondaryTimeZone,
  onSelectPrimaryTimeZone,
  onResetPrimaryToSystem,
  onSwapTimeZones,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'secondary' | 'primary'>('secondary');
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const isInteractive = Boolean(onSelectSecondaryTimeZone || onSelectPrimaryTimeZone);

  useEffect(() => {
    if (!isOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const refDate = useMemo(() => now || new Date(), [now]);

  const filteredZones = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return GLOBAL_EVENT_TIMEZONES;
    return GLOBAL_EVENT_TIMEZONES.filter(
      (tz) =>
        tz.cityKo.toLowerCase().includes(q) ||
        tz.cityEn.toLowerCase().includes(q) ||
        tz.countryKo.toLowerCase().includes(q) ||
        tz.shortCode.toLowerCase().includes(q) ||
        tz.iana.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  const tooltipLabel =
    secondaryMeta && secondaryClock
      ? `듀얼 시간대 · ${viewerMeta.shortCode} / ${secondaryMeta.shortCode}`
      : `시간대 설정 · ${viewerMeta.shortCode} (${viewerClock.utcOffsetLabel})`;

  if (!isInteractive) {
    return (
      <div className="hidden sm:flex items-center shrink-0">
        <TopBarTooltip
          label={`${viewerMeta.cityKo} · ${viewerMeta.shortCode}`}
          shortcut={viewerClock.utcOffsetLabel}
        >
          <div className="h-7 px-2 flex items-center gap-1.5 text-xs text-neutral-400 select-none whitespace-nowrap">
            <span className="text-[11.5px] text-neutral-400 tracking-tight">
              {viewerMeta.cityKo}
            </span>
            <span className="font-mono tabular-nums text-xs text-neutral-200 font-medium">
              {viewerClock.time24}
            </span>
          </div>
        </TopBarTooltip>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative hidden sm:flex items-center shrink-0">
      <TopBarTooltip label={tooltipLabel} disabled={isOpen}>
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-label="글로벌 시간대 설정"
          aria-expanded={isOpen}
          className={`group/tz h-7 px-2 rounded-lg flex items-center gap-1.5 text-xs transition-colors duration-150 cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/25 ${
            isOpen || secondaryMeta
              ? 'bg-white/[0.06] text-neutral-100 hover:bg-white/[0.09]'
              : 'text-neutral-400 hover:text-neutral-100 hover:bg-white/[0.05]'
          }`}
        >
          <span className="text-[11.5px] text-neutral-400 group-hover/tz:text-neutral-200 tracking-tight transition-colors">
            {viewerMeta.cityKo}
          </span>
          <span className="font-mono tabular-nums text-xs text-neutral-200 group-hover/tz:text-white font-medium transition-colors">
            {viewerClock.time24}
          </span>
          {secondaryMeta && secondaryClock && (
            <>
              <span aria-hidden="true" className="text-neutral-600">
                ·
              </span>
              <span className="text-[11.5px] text-sky-300/85 tracking-tight">
                {secondaryMeta.cityKo}
              </span>
              <span className="font-mono tabular-nums text-xs text-sky-200 font-medium">
                {secondaryClock.time24}
              </span>
            </>
          )}
        </button>
      </TopBarTooltip>

      {isOpen && (
        <div className="luxury-glass-border absolute right-0 top-full mt-2 w-80 rounded-xl bg-gradient-to-b from-[#181c27]/82 via-[#11141d]/80 to-[#0c0e15]/88 backdrop-blur-xl backdrop-saturate-150 shadow-[0_24px_56px_-12px_rgba(0,0,0,0.78),0_8px_20px_-4px_rgba(0,0,0,0.5),inset_0_1px_0_0_rgba(255,255,255,0.05)] p-3.5 text-neutral-100 z-[95] overflow-hidden">
          {/* 현재 기준 · 보조 시각 요약 */}
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-white/[0.06]">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] text-neutral-400">
                <Globe2 className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                <span>글로벌 시간대 · 듀얼 타임라인 축</span>
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-xs tabular-nums whitespace-nowrap">
                <span className="text-neutral-200 font-medium">
                  {viewerMeta.cityKo} {viewerClock.time24}
                </span>
                <span className="text-[10px] font-mono text-neutral-500">
                  {viewerMeta.shortCode}
                </span>
                {secondaryMeta && secondaryClock && (
                  <>
                    <span aria-hidden="true" className="text-neutral-600">
                      ·
                    </span>
                    <span className="text-sky-300 font-medium">
                      {secondaryMeta.cityKo} {secondaryClock.time24}
                    </span>
                    <span className="text-[10px] font-mono text-sky-400/75">
                      {secondaryDiffLabel}
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {secondaryMeta && onSwapTimeZones && (
                <button
                  type="button"
                  onClick={onSwapTimeZones}
                  title="기준 시간대와 보조 시간대 맞바꾸기"
                  className="h-7 w-7 rounded-md flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/[0.07] transition-colors cursor-pointer"
                >
                  <ArrowLeftRight className="w-3.5 h-3.5" />
                </button>
              )}
              {isManualPrimary && onResetPrimaryToSystem && (
                <button
                  type="button"
                  onClick={onResetPrimaryToSystem}
                  title="기기 자동 감지 시간대로 복원"
                  className="h-7 w-7 rounded-md flex items-center justify-center text-amber-300/80 hover:text-amber-200 hover:bg-white/[0.07] transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* 탭 전환: 보조 시간대 vs 기준 시간대 */}
          <div className="mt-2.5 grid grid-cols-2 gap-1 rounded-lg bg-white/[0.03] p-0.5 border border-white/[0.06]">
            <button
              type="button"
              onClick={() => setActiveTab('secondary')}
              className={`py-1.5 px-2 rounded-[6px] text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                activeTab === 'secondary'
                  ? 'bg-white/[0.10] text-white'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              보조 시간대 (듀얼 축)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('primary')}
              className={`py-1.5 px-2 rounded-[6px] text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                activeTab === 'primary'
                  ? 'bg-white/[0.10] text-white'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              기준 시간대 전환
            </button>
          </div>

          {/* 도시 검색 */}
          <div className="mt-2.5 relative">
            <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="도시·국가·코드 검색 (예: 자카르타, WIB, 런던)"
              className="w-full h-8 pl-8 pr-7 rounded-lg bg-black/25 border border-white/[0.08] text-xs text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-white/[0.2]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* 보조 축 해제 또는 시스템 시간대 복원 버튼 */}
          {activeTab === 'secondary' && secondaryMeta && onSelectSecondaryTimeZone && (
            <button
              type="button"
              onClick={() => {
                onSelectSecondaryTimeZone(null);
              }}
              className="mt-2 w-full py-1.5 px-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.06] text-[11px] text-neutral-300 flex items-center justify-between transition-colors cursor-pointer whitespace-nowrap"
            >
              <span>보조 시간대 해제 (단일 시간 축으로 복귀)</span>
              <span className="text-[10px] font-mono text-neutral-500">{secondaryMeta.cityKo}</span>
            </button>
          )}

          {activeTab === 'primary' && isManualPrimary && onResetPrimaryToSystem && (
            <button
              type="button"
              onClick={() => {
                onResetPrimaryToSystem();
              }}
              className="mt-2 w-full py-1.5 px-2.5 rounded-lg border border-amber-400/20 bg-amber-400/[0.05] hover:bg-amber-400/[0.1] text-[11px] text-amber-200 flex items-center justify-between transition-colors cursor-pointer whitespace-nowrap"
            >
              <span>기기 자동 감지 시간대로 복귀</span>
              <RotateCcw className="w-3 h-3 shrink-0" />
            </button>
          )}

          {/* 글로벌 시간대 목록 */}
          <div className="mt-2 max-h-56 overflow-y-auto space-y-0.5 pr-0.5">
            {filteredZones.map((tz) => {
              const clock = formatClockInTimeZone(refDate, tz.iana);
              const diff = formatHourDiffShort(viewerMeta.iana, tz.iana, refDate);
              const isSelected =
                activeTab === 'secondary'
                  ? secondaryMeta?.iana === tz.iana
                  : viewerMeta.iana === tz.iana;
              const isDisabledSecondary =
                activeTab === 'secondary' && tz.iana === viewerMeta.iana;

              return (
                <button
                  key={tz.iana}
                  type="button"
                  disabled={isDisabledSecondary}
                  onClick={() => {
                    if (activeTab === 'secondary') {
                      onSelectSecondaryTimeZone?.(isSelected ? null : tz.iana);
                    } else {
                      onSelectPrimaryTimeZone?.(tz.iana);
                    }
                    setIsOpen(false);
                  }}
                  className={`w-full px-2.5 py-1.5 rounded-lg flex items-center justify-between gap-2 text-left text-xs transition-colors ${
                    isDisabledSecondary
                      ? 'opacity-40 cursor-not-allowed'
                      : isSelected
                      ? 'bg-white/[0.09] text-white cursor-pointer'
                      : 'text-neutral-300 hover:bg-white/[0.05] cursor-pointer'
                  }`}
                >
                  <div className="min-w-0 flex items-center gap-1.5">
                    <span className="font-medium truncate">{tz.cityKo}</span>
                    <span className="text-[11px] text-neutral-500 truncate">{tz.countryKo}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 font-mono tabular-nums">
                    <span className="text-[10px] text-neutral-500">
                      {tz.shortCode} · {diff}
                    </span>
                    <span className="text-xs text-neutral-200">{clock.time24}</span>
                    {isSelected && <Check className="w-3.5 h-3.5 text-sky-400 shrink-0" />}
                  </div>
                </button>
              );
            })}
            {filteredZones.length === 0 && (
              <div className="py-6 text-center text-xs text-neutral-500">
                일치하는 도시 또는 시간대가 없습니다.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
