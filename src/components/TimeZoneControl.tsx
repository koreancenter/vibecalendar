import React from 'react';
import { FormattedZoneClock, TimeZoneOption } from '../shared/timeZoneUtils';

interface TimeZoneControlProps {
  viewerMeta: TimeZoneOption;
  viewerClock: FormattedZoneClock;
}

/**
 * 상단 바 앰비언트 로컬 클록 (Zero-UI Luxury Minimalism)
 * 별도 설정 팝오버나 이중 알약 없이, 기기에서 자동 감지된 현재 위치 시각만 고요하게 표시
 */
export const TimeZoneControl: React.FC<TimeZoneControlProps> = ({
  viewerMeta,
  viewerClock,
}) => {
  return (
    <div
      className="hidden sm:flex items-center gap-1.5 px-1.5 text-xs text-neutral-400 select-none whitespace-nowrap shrink-0"
      title={`현재 위치 시간대 · ${viewerMeta.cityKo} (${viewerMeta.iana}, ${viewerClock.utcOffsetLabel})`}
      aria-label={`현재 위치 ${viewerMeta.cityKo} 시각 ${viewerClock.time24} ${viewerMeta.shortCode}`}
    >
      <span className="text-[11px] text-neutral-400 tracking-tight">
        {viewerMeta.cityKo}
      </span>
      <span className="font-mono tabular-nums text-xs text-neutral-200 font-medium">
        {viewerClock.time24}
      </span>
      <span className="hidden lg:inline font-mono text-[10px] text-neutral-500">
        {viewerMeta.shortCode}
      </span>
    </div>
  );
};
