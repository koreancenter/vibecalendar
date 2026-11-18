import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle, Circle, Lock } from 'lucide-react';
import { CalendarEventItem } from '../../types';
import { ResolvedEventTiming } from '../../shared/timeZoneUtils';
import { EventLuxuryTheme } from '../../utils/eventTheme';
import { formatLocalizedEventTimeRange, formatLocalizedEventTitle } from '../../utils/eventLocalization';
import { formatSecondaryZoneLabel, getEventChecklistStats } from './LuxuryEventChip';

export type LuxuryBlockDragState = 'none' | 'moving-same-date' | 'moved-other-date';

export interface LuxuryEventBlockProps {
  /** 'timeline' for positioned Week/Day canvas blocks; 'inspector' for DayInspectorPanel summary cards */
  variant: 'timeline' | 'inspector';
  /** Raw source event */
  event: CalendarEventItem;
  /** Pre-computed luxury theme */
  theme: EventLuxuryTheme;
  /** Pre-computed viewer timezone timing */
  timing?: ResolvedEventTiming;
  /** Selected visual state */
  isSelected?: boolean;
  /** Whether schedule overlap/conflict exists */
  hasConflict?: boolean;
  /** Whether multi-project comparison mode is active */
  showProjectBadge?: boolean;

  // Timeline-specific positioning & interaction props
  isDayMode?: boolean;
  style?: React.CSSProperties;
  heightPx?: number;
  durationMinutes?: number;
  displayStartTime?: string;
  displayEndTime?: string;
  dragState?: LuxuryBlockDragState;
  /** Disables hover-lift pointer capture on background blocks while another block is actively dragged/resized */
  isAnyInteracting?: boolean;
  onDragMouseDown?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onResizeTopMouseDown?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onResizeBottomMouseDown?: (e: React.MouseEvent<HTMLDivElement>) => void;

  // Inspector-specific props
  onClick?: () => void;
  onToggleComplete?: (eventId: string) => void;
}

const LuxuryEventBlockComponent: React.FC<LuxuryEventBlockProps> = ({
  variant,
  event,
  theme,
  timing,
  isSelected = false,
  hasConflict = false,
  showProjectBadge = false,
  isDayMode = false,
  style,
  heightPx = 80,
  durationMinutes = 60,
  displayStartTime,
  displayEndTime,
  dragState = 'none',
  isAnyInteracting = false,
  onDragMouseDown,
  onResizeTopMouseDown,
  onResizeBottomMouseDown,
  onClick,
  onToggleComplete,
}) => {
  const { i18n } = useTranslation();
  const localizedTitle = formatLocalizedEventTitle(event, { locale: i18n.language });
  const proj = theme.project;
  const isCompleted = Boolean(event.isCompleted);
  const isReadOnlyExternal = Boolean(event.externalSync?.readOnly);
  const isMaskedExternal = Boolean(event.externalSync?.isMasked);
  const externalProviderShort = event.externalSync
    ? event.externalSync.provider === 'google'
      ? 'GCal'
      : event.externalSync.provider === 'microsoft'
      ? 'Outlook'
      : 'CalDAV'
    : null;
  const { total: checklistTotal, done: checklistDone } = getEventChecklistStats(event);

  if (variant === 'inspector') {
    const primaryTime = formatLocalizedEventTimeRange(event, i18n.language, timing);
    const secondaryZone = formatSecondaryZoneLabel(event, timing);

    return (
      <div
        data-selected={isSelected ? 'true' : undefined}
        onClick={onClick}
        className={`relative overflow-hidden px-4 py-3.5 rounded-[10px] border luxury-event-card hover:z-20 cursor-pointer flex items-start justify-between gap-3.5 ${
          theme.blockSurfaceClass
        } ${theme.hoverBorderClass} ${isSelected ? theme.selectedSurfaceClass : ''} ${
          isCompleted ? 'opacity-75' : ''
        }`}
      >

        <div className="relative z-10 flex-1 min-w-0">
          <div className="flex items-center gap-2 text-[11px] tabular-nums tracking-[0.035em] leading-[1.4] truncate">
            {showProjectBadge && proj && (
              <>
                <span
                  className={`font-medium tracking-[0.03em] shrink-0 ${theme.accentTextClass}`}
                  title={proj.name}
                >
                  {proj.code || proj.name.slice(0, 5)}
                </span>
                <span aria-hidden="true" className="text-white/45 shrink-0">
                  ·
                </span>
              </>
            )}

            <span className="font-normal text-white/85 shrink-0">{primaryTime}</span>

            {secondaryZone && (
              <>
                <span aria-hidden="true" className="text-white/40 shrink-0">
                  ·
                </span>
                <span className="font-normal tracking-[0.025em] text-white/70 truncate">
                  {secondaryZone}
                </span>
              </>
            )}

            {externalProviderShort && (
              <>
                <span aria-hidden="true" className="text-white/40 shrink-0">
                  ·
                </span>
                <span className="font-normal tracking-[0.025em] text-white/75 shrink-0">
                  {isMaskedExternal ? `${externalProviderShort} 마스킹` : externalProviderShort}
                </span>
              </>
            )}

            {(checklistTotal > 0 || hasConflict) && (
              <span className="ml-auto flex items-center gap-1.5 shrink-0 pl-2">
                {checklistTotal > 0 && (
                  <span className="text-[10.5px] font-medium tracking-[0.04em] text-white/75 tabular-nums">
                    {checklistDone}/{checklistTotal}
                  </span>
                )}
                {hasConflict && <AlertTriangle className="w-3 h-3 text-amber-300" />}
              </span>
            )}
          </div>

          <h5
            className={`text-[13px] font-medium tracking-[0.015em] leading-[1.52] mt-2 truncate flex items-center gap-1.5 ${
              isCompleted ? 'line-through text-white/60' : isMaskedExternal ? 'text-white/85' : 'text-white'
            }`}
          >
            {isMaskedExternal && <Lock className="w-3 h-3 text-white/65 shrink-0" />}
            <span className="truncate">{localizedTitle}</span>
          </h5>

          {(event.location || event.locationAddress) && (
            <div className="mt-2 space-y-1 min-w-0">
              {event.location && (
                <p className="text-[11px] font-normal leading-[1.5] text-white/88 truncate tracking-[0.016em]">
                  {event.location}
                </p>
              )}
              {event.locationAddress && (
                <p className="text-[10.5px] font-normal leading-[1.48] text-white/72 truncate tracking-[0.02em]">
                  {event.locationAddress}
                </p>
              )}
            </div>
          )}
        </div>

        {onToggleComplete && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleComplete(event.id);
            }}
            className="relative z-10 mt-0.5 text-white/60 hover:text-emerald-300 transition-colors cursor-pointer shrink-0"
            title={isCompleted ? '완료 해제' : '완료 표시'}
          >
            {isCompleted ? (
              <CheckCircle className="w-4 h-4 text-emerald-300" />
            ) : (
              <Circle className="w-4 h-4" />
            )}
          </button>
        )}
      </div>
    );
  }

  // variant === 'timeline'
  const isMovedToOtherDate = dragState === 'moved-other-date';
  const isMovedInSameDate = dragState === 'moving-same-date';
  const isActivelyMoving = isMovedToOtherDate || isMovedInSameDate;

  const isCompactBlock = heightPx < 52 || (!isDayMode && durationMinutes < 40);
  const isLargeBlock = heightPx >= 92;

  const resolvedStart = displayStartTime ?? timing?.localStartTime ?? event.startTime;
  const resolvedEnd = displayEndTime ?? timing?.localEndTime ?? event.endTime;
  const primaryRangeText = `${resolvedStart} – ${resolvedEnd}`;
  const secondaryZoneText = !isMovedInSameDate
    ? formatSecondaryZoneLabel(event, timing)
    : null;

  const paddingClasses = isCompactBlock
    ? isDayMode
      ? 'rounded-[9px] px-3.5 py-1'
      : 'rounded-[8px] px-3 py-0.5'
    : isLargeBlock
    ? isDayMode
      ? 'rounded-[11px] px-4 py-4'
      : 'rounded-[10px] px-4 py-3.5'
    : isDayMode
    ? 'rounded-[10px] px-3.5 py-2.5'
    : 'rounded-[9px] px-3 py-2';

  const backgroundShieldClass =
    isAnyInteracting && !isActivelyMoving ? 'pointer-events-none' : '';

  return (
    <div
      data-dragging={isActivelyMoving ? 'true' : undefined}
      data-selected={isSelected && !isMovedToOtherDate ? 'true' : undefined}
      onMouseDown={onDragMouseDown}
      style={style}
      className={`absolute ${paddingClasses} luxury-event-card ${
        isReadOnlyExternal ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'
      } z-10 hover:z-20 flex flex-col justify-between overflow-hidden select-none border ${
        theme.blockSurfaceClass
      } ${!isMovedToOtherDate ? theme.hoverBorderClass : ''} ${
        isSelected && !isMovedToOtherDate ? `${theme.selectedSurfaceClass} !z-30` : ''
      } ${
        isMovedToOtherDate
          ? 'opacity-25 border-dashed pointer-events-none'
          : isMovedInSameDate
          ? '!z-50 shadow-2xl ring-1 ring-white/30 opacity-95'
          : ''
      } ${isCompleted && !isMovedToOtherDate ? 'opacity-75' : ''} ${backgroundShieldClass}`}
    >
      {/* 상단 리사이즈 영역 (시각 표시 제거) */}
      {onResizeTopMouseDown && !isReadOnlyExternal && (
        <div
          onMouseDown={onResizeTopMouseDown}
          className="absolute top-0 left-0 right-0 h-2 cursor-ns-resize z-20"
          title="위로 당겨 시작 시간 조정"
        />
      )}

      {isCompactBlock ? (
        <div className="relative z-10 flex items-center gap-2.5 w-full overflow-hidden leading-[1.4] my-auto">
          {hasConflict && <AlertTriangle className="w-3 h-3 text-amber-300 shrink-0" />}
          {isCompleted && <CheckCircle className="w-3 h-3 text-emerald-300 shrink-0" />}
          {isMaskedExternal && <Lock className="w-2.5 h-2.5 text-white/65 shrink-0" />}
          <span className="text-[10.5px] font-normal text-white/82 shrink-0 tabular-nums tracking-[0.032em]">
            {resolvedStart}
          </span>
          <span
            className={`text-[11.5px] font-medium truncate tracking-[0.014em] ${
              isCompleted ? 'line-through text-white/60' : isMaskedExternal ? 'text-white/85' : 'text-white'
            }`}
          >
            {localizedTitle}
          </span>
        </div>
      ) : (
        <>
          <div className="relative z-10 flex flex-col h-full overflow-hidden justify-start min-w-0">
            <div className="flex items-center gap-2 text-[10.5px] sm:text-[11px] tabular-nums leading-[1.4] min-w-0 tracking-[0.035em]">
              {showProjectBadge && proj && (
                <>
                  <span
                    className={`font-medium tracking-[0.03em] shrink-0 ${theme.accentTextClass}`}
                    title={proj.name}
                  >
                    {proj.code || proj.name.slice(0, 5)}
                  </span>
                  <span aria-hidden="true" className="text-white/45 shrink-0">
                    ·
                  </span>
                </>
              )}

              <span className="font-normal text-white/85 shrink-0">{primaryRangeText}</span>

              {secondaryZoneText && (
                <>
                  <span aria-hidden="true" className="text-white/40 shrink-0">
                    ·
                  </span>
                  <span className="font-normal tracking-[0.025em] text-white/70 truncate">
                    {secondaryZoneText}
                  </span>
                </>
              )}

              {(checklistTotal > 0 || hasConflict || isCompleted) && (
                <span className="ml-auto flex items-center gap-1.5 shrink-0 pl-2">
                  {checklistTotal > 0 && (
                    <span
                      className="text-[10.5px] font-medium tracking-[0.04em] text-white/75 tabular-nums"
                      title={`체크리스트 ${checklistDone}/${checklistTotal}`}
                    >
                      {checklistDone}/{checklistTotal}
                    </span>
                  )}
                  {hasConflict && <AlertTriangle className="w-3 h-3 text-amber-300" />}
                  {isCompleted && <CheckCircle className="w-3 h-3 text-emerald-300" />}
                </span>
              )}
            </div>

            <div
              className={`${
                isDayMode ? 'text-[13px] sm:text-[13.5px]' : 'text-[12px]'
              } font-medium leading-[1.52] ${
                isLargeBlock ? 'mt-2' : 'mt-1.5'
              } tracking-[0.015em] ${
                heightPx >= 140 ? 'line-clamp-2 break-keep' : 'truncate'
              } flex items-center gap-1.5 ${
                isCompleted ? 'line-through text-white/60' : isMaskedExternal ? 'text-white/85' : 'text-white'
              }`}
            >
              {isMaskedExternal && <Lock className="w-3 h-3 text-white/65 shrink-0" />}
              <span className="truncate">{localizedTitle}</span>
            </div>

            {!isLargeBlock &&
              heightPx >= 72 &&
              (event.location || event.locationAddress) && (
                <p className="text-[10.5px] font-normal text-white/80 mt-1.5 truncate leading-[1.45] tracking-[0.016em]">
                  {event.location || event.locationAddress}
                </p>
              )}

            {isLargeBlock && (event.location || event.locationAddress) && (
              <div className="mt-2.5 space-y-1 min-w-0">
                {event.location && (
                  <p
                    className={`${
                      isDayMode ? 'text-[11.5px]' : 'text-[11px]'
                    } text-white/88 font-normal leading-[1.48] truncate tracking-[0.016em]`}
                  >
                    {event.location}
                  </p>
                )}
                {event.locationAddress &&
                  (heightPx >= 108 || isDayMode || !event.location) && (
                    <p
                      className={`${
                        isDayMode ? 'text-[11px]' : 'text-[10.5px]'
                      } text-white/72 font-normal truncate leading-[1.48] tracking-[0.02em]`}
                    >
                      {event.locationAddress}
                    </p>
                  )}
              </div>
            )}
          </div>
        </>
      )}

      {/* 하단 리사이즈 영역 (시각 표시 제거) */}
      {onResizeBottomMouseDown && !isReadOnlyExternal && (
        <div
          onMouseDown={onResizeBottomMouseDown}
          className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize z-20"
          title="아래로 당겨 종료 시간 조정"
        />
      )}
    </div>
  );
};

export const LuxuryEventBlock = React.memo(LuxuryEventBlockComponent);

export interface LuxuryTimelineDragPreviewProps {
  isDayMode: boolean;
  isCrossDate: boolean;
  columnDate: string;
  eventTitle: string;
  startTimeLabel: string;
  endTimeLabel: string;
  topPx: number;
  heightPx: number;
}

const LuxuryTimelineDragPreviewComponent: React.FC<LuxuryTimelineDragPreviewProps> = ({
  isDayMode,
  isCrossDate,
  columnDate,
  eventTitle,
  startTimeLabel,
  endTimeLabel,
  topPx,
  heightPx,
}) => {
  return (
    <div
      style={{
        top: `${topPx}px`,
        height: `${Math.max(24, heightPx)}px`,
      }}
      className={`absolute ${
        isDayMode
          ? 'left-3 right-6 px-4 py-2 rounded-[10px]'
          : 'left-[4.5px] right-[9px] px-3 py-1.5 rounded-[9px]'
      } z-40 pointer-events-none flex flex-col justify-center overflow-hidden ${
        isCrossDate
          ? 'luxury-glass-border bg-gradient-to-b from-[#1a1f2c]/95 via-[#131722]/94 to-[#0e111a]/96 backdrop-blur-xl shadow-[0_18px_40px_-10px_rgba(0,0,0,0.85)]'
          : 'bg-white/[0.04] border border-white/20 border-dashed backdrop-blur-xs'
      }`}
    >
      {isCrossDate && (
        <span className="text-[11.5px] font-medium text-white tracking-[0.014em] leading-[1.45] truncate">
          {eventTitle}
        </span>
      )}
      <span className="text-[10.5px] font-normal text-white/85 tabular-nums tracking-[0.032em] leading-[1.4] truncate">
        {isCrossDate ? `${columnDate.slice(5).replace('-', '.')} · ` : ''}
        {startTimeLabel} – {endTimeLabel}
      </span>
    </div>
  );
};

export const LuxuryTimelineDragPreview = React.memo(LuxuryTimelineDragPreviewComponent);
