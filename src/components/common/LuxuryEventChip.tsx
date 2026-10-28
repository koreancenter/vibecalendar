import React from 'react';
import { AlertTriangle, CheckCircle } from 'lucide-react';
import { CalendarEventItem } from '../../types';
import { ResolvedEventTiming } from '../../shared/timeZoneUtils';
import { EventLuxuryTheme } from '../../utils/eventTheme';

export interface EventChecklistStats {
  total: number;
  done: number;
  rate: number;
}

export function getEventChecklistStats(
  event?: Pick<CalendarEventItem, 'checklist'> | null
): EventChecklistStats {
  const items = event?.checklist;
  if (!items || items.length === 0) {
    return { total: 0, done: 0, rate: 0 };
  }
  let done = 0;
  for (let i = 0; i < items.length; i++) {
    if (items[i].done) done += 1;
  }
  const total = items.length;
  return {
    total,
    done,
    rate: Math.round((done / total) * 100),
  };
}

export function formatSecondaryZoneLabel(
  event: Pick<CalendarEventItem, 'isAllDay' | 'startTime'>,
  timing?: ResolvedEventTiming | null
): string | null {
  if (event.isAllDay || !timing || timing.isSameZone) {
    return null;
  }
  return timing.hasOffsetDiff
    ? `${timing.sourceMeta.cityKo} ${event.startTime}`
    : timing.sourceMeta.cityKo;
}

export interface LuxuryEventChipProps {
  event: CalendarEventItem;
  theme: EventLuxuryTheme;
  /** 'sm' for Month grid & Week all-day strip (25px); 'md' for Day agenda all-day strip (27px) */
  size?: 'sm' | 'md';
  /** Optional leading time or '종일' label */
  timeLabel?: string;
  /** Whether multi-project comparison mode is active */
  showProjectBadge?: boolean;
  /** Maximum characters for fallback project name abbreviation when code is absent */
  projectCodeMaxLength?: number;
  /** Show inline CheckCircle icon when event.isCompleted is true */
  showCompletionIcon?: boolean;
  /** Show inline AlertTriangle icon when schedule conflict exists */
  hasConflict?: boolean;
  /** Show compact done/total checklist counter when checklist items exist */
  showChecklistBadge?: boolean;
  /** Selected visual state */
  isSelected?: boolean;
  /** Whether THIS chip is actively being dragged */
  isDragging?: boolean;
  /** Whether ANY chip in the parent grid is being dragged (disables pointer capture on siblings to prevent dragleave flicker) */
  isAnyDragging?: boolean;
  /** Enable HTML5 drag-and-drop on this chip */
  draggable?: boolean;
  /** Optional native title tooltip */
  titleAttr?: string;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (e: React.DragEvent<HTMLDivElement>) => void;
  onMouseEnter?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMouseLeave?: (e: React.MouseEvent<HTMLDivElement>) => void;
}

const LuxuryEventChipComponent: React.FC<LuxuryEventChipProps> = ({
  event,
  theme,
  size = 'sm',
  timeLabel,
  showProjectBadge = false,
  projectCodeMaxLength = 3,
  showCompletionIcon = false,
  hasConflict = false,
  showChecklistBadge = false,
  isSelected = false,
  isDragging = false,
  isAnyDragging = false,
  draggable = false,
  titleAttr,
  onClick,
  onDragStart,
  onDragEnd,
  onMouseEnter,
  onMouseLeave,
}) => {
  const proj = theme.project;
  const isCompleted = Boolean(event.isCompleted);
  const { total: checklistTotal, done: checklistDone } = showChecklistBadge
    ? getEventChecklistStats(event)
    : { total: 0, done: 0 };

  const sizeClasses =
    size === 'md'
      ? 'h-[27px] px-3 rounded-[7px] text-xs'
      : 'h-[25px] w-full text-left px-2.5 rounded-[6px] text-[11.5px] shrink-0';

  const cursorClasses = draggable
    ? 'cursor-grab active:cursor-grabbing'
    : 'cursor-pointer';

  const siblingDragShieldClass =
    isAnyDragging && !isDragging ? 'pointer-events-none' : '';

  return (
    <div
      draggable={draggable || undefined}
      data-dragging={isDragging ? 'true' : undefined}
      data-selected={isSelected && !isDragging ? 'true' : undefined}
      title={titleAttr}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      className={`relative overflow-hidden ${sizeClasses} font-[450] tracking-[0.014em] leading-[1.4] flex items-center gap-2.5 border luxury-event-chip hover:z-20 ${cursorClasses} ${
        theme.chipSurfaceClass
      } ${isSelected && !isDragging ? theme.selectedSurfaceClass : ''} ${
        isDragging ? 'opacity-30 scale-95 border-dashed border-white/35' : ''
      } ${isCompleted && !isDragging ? 'opacity-55' : ''} ${siblingDragShieldClass}`}
    >
      <span
        aria-hidden="true"
        className={`relative z-10 w-[2px] h-3 rounded-full shrink-0 ${theme.inlayClass}`}
      />

      {timeLabel && (
        <span className="relative z-10 text-[10.5px] font-[370] text-white/46 shrink-0 tabular-nums tracking-[0.032em]">
          {timeLabel}
        </span>
      )}

      {showProjectBadge && proj && (
        <span
          className={`relative z-10 ${
            size === 'md' ? 'text-[10.5px]' : 'text-[10px]'
          } font-[440] shrink-0 tracking-[0.03em] ${theme.accentTextClass}`}
        >
          {proj.code || proj.name.slice(0, projectCodeMaxLength)}
        </span>
      )}

      {hasConflict && (
        <AlertTriangle className="relative z-10 w-3 h-3 text-amber-300/90 shrink-0" />
      )}

      {showCompletionIcon && isCompleted && (
        <CheckCircle className="relative z-10 w-3 h-3 text-emerald-300/90 shrink-0" />
      )}

      <span
        className={`relative z-10 truncate ${
          isCompleted ? 'line-through text-white/32' : 'text-[#f2f4f8]'
        }`}
      >
        {event.title}
      </span>

      {showChecklistBadge && checklistTotal > 0 && (
        <span
          className="relative z-10 ml-auto pl-1 text-[10px] font-[360] tracking-[0.04em] text-white/36 tabular-nums shrink-0"
          title={`체크리스트 ${checklistDone}/${checklistTotal}`}
        >
          {checklistDone}/{checklistTotal}
        </span>
      )}
    </div>
  );
};

export const LuxuryEventChip = React.memo(LuxuryEventChipComponent);
