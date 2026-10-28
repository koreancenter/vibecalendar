import React from 'react';
import { AlertTriangle, CheckCircle, Circle } from 'lucide-react';
import { CalendarEventItem } from '../../types';
import { ResolvedEventTiming } from '../../shared/timeZoneUtils';
import { EventLuxuryTheme } from '../../utils/eventTheme';
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
  const proj = theme.project;
  const isCompleted = Boolean(event.isCompleted);
  const { total: checklistTotal, done: checklistDone } = getEventChecklistStats(event);

  if (variant === 'inspector') {
    const primaryTime = event.isAllDay
      ? '종일'
      : timing
      ? `${timing.localStartTime} – ${timing.localEndTime}`
      : `${event.startTime} – ${event.endTime}`;
    const secondaryZone = formatSecondaryZoneLabel(event, timing);

    return (
      <div
        data-selected={isSelected ? 'true' : undefined}
        onClick={onClick}
        className={`relative overflow-hidden pl-[24px] pr-4 py-3.5 rounded-[10px] border luxury-event-card hover:z-20 cursor-pointer group flex items-start justify-between gap-3.5 ${
          theme.blockSurfaceClass
        } ${isSelected ? theme.selectedSurfaceClass : ''} ${isCompleted ? 'opacity-60' : ''}`}
      >
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute z-10 left-[11px] top-3.5 bottom-3.5 w-[2px] rounded-full ${theme.inlayClass}`}
        />

        <div className="relative z-10 flex-1 min-w-0">
          <div className="flex items-center gap-2 text-[11px] tabular-nums tracking-[0.035em] leading-[1.4] truncate">
            {showProjectBadge && proj && (
              <>
                <span
                  className={`font-[440] tracking-[0.03em] shrink-0 ${theme.accentTextClass}`}
                  title={proj.name}
                >
                  {proj.code || proj.name.slice(0, 5)}
                </span>
                <span aria-hidden="true" className="text-white/22 shrink-0">
                  ·
                </span>
              </>
            )}

            <span className="font-[370] text-white/52 shrink-0">{primaryTime}</span>

            {secondaryZone && (
              <>
                <span aria-hidden="true" className="text-white/20 shrink-0">
                  ·
                </span>
                <span className="font-[350] tracking-[0.025em] text-white/32 truncate">
                  {secondaryZone}
                </span>
              </>
            )}

            {(checklistTotal > 0 || hasConflict) && (
              <span className="ml-auto flex items-center gap-1.5 shrink-0 pl-2">
                {checklistTotal > 0 && (
                  <span className="text-[10.5px] font-[360] tracking-[0.04em] text-white/34 tabular-nums">
                    {checklistDone}/{checklistTotal}
                  </span>
                )}
                {hasConflict && <AlertTriangle className="w-3 h-3 text-amber-300/90" />}
              </span>
            )}
          </div>

          <h5
            className={`text-[13px] font-[450] tracking-[0.015em] leading-[1.52] mt-2 truncate ${
              isCompleted ? 'line-through text-white/34' : 'text-[#f2f4f8]'
            }`}
          >
            {event.title}
          </h5>

          {(event.location || event.locationAddress) && (
            <div className="mt-2 space-y-1 min-w-0">
              {event.location && (
                <p className="text-[11px] font-[380] leading-[1.5] text-white/58 truncate tracking-[0.016em]">
                  {event.location}
                </p>
              )}
              {event.locationAddress && (
                <p className="text-[10.5px] font-[350] leading-[1.48] text-white/34 truncate tracking-[0.02em]">
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
            className="relative z-10 mt-0.5 text-white/28 hover:text-emerald-300 transition-colors cursor-pointer shrink-0"
            title={isCompleted ? '완료 해제' : '완료 표시'}
          >
            {isCompleted ? (
              <CheckCircle className="w-4 h-4 text-emerald-300/90" />
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
      ? 'rounded-[11px] pl-[26px] pr-4 py-4'
      : 'rounded-[10px] pl-[24px] pr-4 py-3.5'
    : isDayMode
    ? 'rounded-[10px] pl-[22px] pr-3.5 py-2.5'
    : 'rounded-[9px] pl-[20px] pr-3 py-2';

  const inlayGeometryClasses = isLargeBlock
    ? isDayMode
      ? 'left-[12px] top-4 bottom-4'
      : 'left-[11px] top-3.5 bottom-3.5'
    : isDayMode
    ? 'left-[10px] top-2.5 bottom-2.5'
    : 'left-[9px] top-2 bottom-2';

  const backgroundShieldClass =
    isAnyInteracting && !isActivelyMoving ? 'pointer-events-none' : '';

  return (
    <div
      data-dragging={isActivelyMoving ? 'true' : undefined}
      data-selected={isSelected && !isMovedToOtherDate ? 'true' : undefined}
      onMouseDown={onDragMouseDown}
      style={style}
      className={`group absolute ${paddingClasses} luxury-event-card cursor-grab active:cursor-grabbing z-10 hover:z-20 flex flex-col justify-between overflow-hidden select-none border ${
        theme.blockSurfaceClass
      } ${
        isSelected && !isMovedToOtherDate ? `${theme.selectedSurfaceClass} !z-30` : ''
      } ${
        isMovedToOtherDate
          ? 'opacity-25 border-dashed pointer-events-none'
          : isMovedInSameDate
          ? '!z-50 shadow-2xl ring-1 ring-white/30 opacity-95'
          : ''
      } ${isCompleted && !isMovedToOtherDate ? 'opacity-55' : ''} ${backgroundShieldClass}`}
    >
      {/* 상단 리사이즈 핸들 */}
      {onResizeTopMouseDown && (
        <div
          onMouseDown={onResizeTopMouseDown}
          className="absolute top-0 left-0 right-0 h-2 cursor-ns-resize z-20 flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-white/[0.05] transition-opacity duration-150"
          title="위로 당겨 시작 시간 조정"
        >
          <div className="w-5 h-0.5 rounded-full bg-white/25" />
        </div>
      )}

      {isCompactBlock ? (
        <div className="relative z-10 flex items-center gap-2.5 w-full overflow-hidden leading-[1.4] my-auto">
          <span
            aria-hidden="true"
            className={`w-[2px] h-3 rounded-full shrink-0 ${theme.inlayClass}`}
          />
          {hasConflict && <AlertTriangle className="w-3 h-3 text-amber-300/90 shrink-0" />}
          {isCompleted && <CheckCircle className="w-3 h-3 text-emerald-300/90 shrink-0" />}
          <span className="text-[10.5px] font-[370] text-white/46 shrink-0 tabular-nums tracking-[0.032em]">
            {resolvedStart}
          </span>
          <span
            className={`text-[11.5px] font-[450] truncate tracking-[0.014em] ${
              isCompleted ? 'line-through text-white/34' : 'text-[#f2f4f8]'
            }`}
          >
            {event.title}
          </span>
        </div>
      ) : (
        <>
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute z-10 w-[2px] rounded-full ${inlayGeometryClasses} ${theme.inlayClass}`}
          />

          <div className="relative z-10 flex flex-col h-full overflow-hidden justify-start min-w-0">
            <div className="flex items-center gap-2 text-[10.5px] sm:text-[11px] tabular-nums leading-[1.4] min-w-0 tracking-[0.035em]">
              {showProjectBadge && proj && (
                <>
                  <span
                    className={`font-[440] tracking-[0.03em] shrink-0 ${theme.accentTextClass}`}
                    title={proj.name}
                  >
                    {proj.code || proj.name.slice(0, 5)}
                  </span>
                  <span aria-hidden="true" className="text-white/22 shrink-0">
                    ·
                  </span>
                </>
              )}

              <span className="font-[370] text-white/52 shrink-0">{primaryRangeText}</span>

              {secondaryZoneText && (
                <>
                  <span aria-hidden="true" className="text-white/20 shrink-0">
                    ·
                  </span>
                  <span className="font-[350] tracking-[0.025em] text-white/32 truncate">
                    {secondaryZoneText}
                  </span>
                </>
              )}

              {(checklistTotal > 0 || hasConflict || isCompleted) && (
                <span className="ml-auto flex items-center gap-1.5 shrink-0 pl-2">
                  {checklistTotal > 0 && (
                    <span
                      className="text-[10.5px] font-[360] tracking-[0.04em] text-white/34 tabular-nums"
                      title={`체크리스트 ${checklistDone}/${checklistTotal}`}
                    >
                      {checklistDone}/{checklistTotal}
                    </span>
                  )}
                  {hasConflict && <AlertTriangle className="w-3 h-3 text-amber-300/90" />}
                  {isCompleted && <CheckCircle className="w-3 h-3 text-emerald-300/90" />}
                </span>
              )}
            </div>

            <div
              className={`${
                isDayMode ? 'text-[13px] sm:text-[13.5px]' : 'text-[12px]'
              } font-[450] leading-[1.52] ${
                isLargeBlock ? 'mt-2' : 'mt-1.5'
              } tracking-[0.015em] ${
                heightPx >= 140 ? 'line-clamp-2 break-keep' : 'truncate'
              } ${isCompleted ? 'line-through text-white/34' : 'text-[#f2f4f8]'}`}
            >
              {event.title}
            </div>

            {!isLargeBlock &&
              heightPx >= 72 &&
              (event.location || event.locationAddress) && (
                <p className="text-[10.5px] font-[370] text-white/44 mt-1.5 truncate leading-[1.45] tracking-[0.016em]">
                  {event.location || event.locationAddress}
                </p>
              )}

            {isLargeBlock && (event.location || event.locationAddress) && (
              <div className="mt-2.5 space-y-1 min-w-0">
                {event.location && (
                  <p
                    className={`${
                      isDayMode ? 'text-[11.5px]' : 'text-[11px]'
                    } text-white/58 font-[380] leading-[1.48] truncate tracking-[0.016em]`}
                  >
                    {event.location}
                  </p>
                )}
                {event.locationAddress &&
                  (heightPx >= 108 || isDayMode || !event.location) && (
                    <p
                      className={`${
                        isDayMode ? 'text-[11px]' : 'text-[10.5px]'
                      } text-white/34 font-[350] truncate leading-[1.48] tracking-[0.02em]`}
                    >
                      {event.locationAddress}
                    </p>
                  )}
              </div>
            )}
          </div>
        </>
      )}

      {/* 하단 리사이즈 핸들 */}
      {onResizeBottomMouseDown && (
        <div
          onMouseDown={onResizeBottomMouseDown}
          className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize z-20 flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-white/[0.05] transition-opacity duration-150"
          title="아래로 당겨 종료 시간 조정"
        >
          <div className="w-5 h-0.5 rounded-full bg-white/25" />
        </div>
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
  inlayClass?: string;
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
  inlayClass,
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
      {isCrossDate && inlayClass && (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute left-[6px] top-2 bottom-2 w-[2px] rounded-full ${inlayClass}`}
        />
      )}
      {isCrossDate && (
        <span className="pl-1.5 text-[11.5px] font-[450] text-[#f2f4f8] tracking-[0.014em] leading-[1.45] truncate">
          {eventTitle}
        </span>
      )}
      <span
        className={`${
          isCrossDate ? 'pl-1.5' : ''
        } text-[10.5px] font-[370] text-white/60 tabular-nums tracking-[0.032em] leading-[1.4] truncate`}
      >
        {isCrossDate ? `${columnDate.slice(5).replace('-', '.')} · ` : ''}
        {startTimeLabel} – {endTimeLabel}
      </span>
    </div>
  );
};

export const LuxuryTimelineDragPreview = React.memo(LuxuryTimelineDragPreviewComponent);
