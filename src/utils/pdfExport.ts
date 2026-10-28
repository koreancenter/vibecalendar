import { jsPDF } from 'jspdf';
import { CalendarCategory, CalendarEventItem, ProjectItem } from '../types';
import {
  getCalendarGrid,
  getDayOfWeekShort,
  getTodayDateString,
  getWeekDays,
  getWeekRangeLabel,
  parseLocalDate,
} from '../shared/dateUtils';
import { calculateCompletionStats, timeToMinutes } from '../shared/scheduleUtils';
import { formatCombinedLocation } from '../shared/locationUtils';
import { layoutTimeEvents } from './timeGridLayout';

export type PdfExportScope = 'month' | 'week' | 'both';
export type PdfThemeMode = 'obsidian' | 'editorial';

export interface PdfExportOptions {
  scope: PdfExportScope;
  theme: PdfThemeMode;
  currentYear: number;
  currentMonth: number; // 0-indexed (0 = 1월)
  selectedDate: string; // YYYY-MM-DD
  events: CalendarEventItem[];
  projects: ProjectItem[];
  selectedProjectIds: string[];
  selectedCategory: CalendarCategory | '전체';
}

export interface PdfExportResult {
  filename: string;
  pageCount: number;
  eventCount: number;
}

interface ThemePalette {
  mode: PdfThemeMode;
  pageBg: string;
  surfaceBg: string;
  surfaceAltBg: string;
  surfaceMutedBg: string;
  headerStripBg: string;
  borderStrong: string;
  borderSubtle: string;
  borderFaint: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textDim: string;
  textSunday: string;
  textSaturday: string;
  accentGold: string;
  todayBadgeBg: string;
  todayBadgeText: string;
  selectedCellStroke: string;
  completedColor: string;
  chipFillAlpha: number;
  chipStrokeAlpha: number;
}

const PALETTES: Record<PdfThemeMode, ThemePalette> = {
  obsidian: {
    mode: 'obsidian',
    pageBg: '#0b0d13',
    surfaceBg: '#10141e',
    surfaceAltBg: '#141926',
    surfaceMutedBg: '#0d1018',
    headerStripBg: '#161c2a',
    borderStrong: 'rgba(255, 255, 255, 0.16)',
    borderSubtle: 'rgba(255, 255, 255, 0.085)',
    borderFaint: 'rgba(255, 255, 255, 0.045)',
    textPrimary: '#f8fafc',
    textSecondary: '#cbd5e1',
    textMuted: '#94a3b8',
    textDim: '#475569',
    textSunday: '#fb7185',
    textSaturday: '#93c5fd',
    accentGold: '#d4af37',
    todayBadgeBg: '#f8fafc',
    todayBadgeText: '#0b0d13',
    selectedCellStroke: 'rgba(212, 175, 55, 0.55)',
    completedColor: '#34d399',
    chipFillAlpha: 0.16,
    chipStrokeAlpha: 0.42,
  },
  editorial: {
    mode: 'editorial',
    pageBg: '#ffffff',
    surfaceBg: '#ffffff',
    surfaceAltBg: '#f8fafc',
    surfaceMutedBg: '#f1f5f9',
    headerStripBg: '#f8fafc',
    borderStrong: '#cbd5e1',
    borderSubtle: '#e2e8f0',
    borderFaint: '#f1f5f9',
    textPrimary: '#0f172a',
    textSecondary: '#334155',
    textMuted: '#64748b',
    textDim: '#94a3b8',
    textSunday: '#e11d48',
    textSaturday: '#2563eb',
    accentGold: '#9a7316',
    todayBadgeBg: '#0f172a',
    todayBadgeText: '#ffffff',
    selectedCellStroke: '#0f172a',
    completedColor: '#059669',
    chipFillAlpha: 0.1,
    chipStrokeAlpha: 0.36,
  },
};

const CATEGORY_HEX_MAP: Record<CalendarCategory, string> = {
  '업무': '#3b82f6',
  '방문·출장': '#10b981',
  '식사·모임': '#d97706',
  '개인': '#a855f7',
  '행사·세미나': '#f43f5e',
  '기타': '#64748b',
};

// A4 Landscape @ ~213 DPI (297mm x 210mm 비율 1.414285)
const PAGE_W = 2480;
const PAGE_H = 1754;
const MARGIN_X = 96;
const MARGIN_TOP = 84;
const FOOTER_Y = PAGE_H - 58;

const FONT_SANS =
  '"Plus Jakarta Sans", "Pretendard Variable", Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';
const FONT_MONO =
  '"JetBrains Mono", "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토'] as const;

function hexToRgba(hex: string, alpha: number): string {
  const clean = (hex || '#64748b').replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) {
    return `rgba(100, 116, 139, ${alpha})`;
  }
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getEventAccentHex(
  ev: CalendarEventItem,
  projectById: Map<string, ProjectItem>
): string {
  if (ev.projectId) {
    const proj = projectById.get(ev.projectId);
    if (proj?.color) return proj.color;
  }
  return CATEGORY_HEX_MAP[ev.category] || '#64748b';
}

function sortEventsChronologically(list: CalendarEventItem[]): CalendarEventItem[] {
  return [...list].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.isAllDay !== b.isAllDay) return a.isAllDay ? -1 : 1;
    return timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
  });
}

function truncateText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string {
  if (!text) return '';
  if (maxWidth <= 0) return '';
  if (ctx.measureText(text).width <= maxWidth) return text;

  const ellipsis = '…';
  const ellipsisW = ctx.measureText(ellipsis).width;
  if (ellipsisW >= maxWidth) return '';

  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = text.slice(0, mid);
    if (ctx.measureText(candidate).width + ellipsisW <= maxWidth) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return text.slice(0, low).trimEnd() + ellipsis;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
}

function createPageCanvas(palette: ThemePalette): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('PDF 캔버스 컨텍스트를 초기화할 수 없습니다.');
  }
  ctx.fillStyle = palette.pageBg;
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  ctx.textBaseline = 'middle';
  return { canvas, ctx };
}

function computeChecklistStats(events: CalendarEventItem[]): {
  done: number;
  total: number;
} {
  let done = 0;
  let total = 0;
  for (const ev of events) {
    if (ev.checklist && ev.checklist.length > 0) {
      total += ev.checklist.length;
      done += ev.checklist.filter((c) => c.done).length;
    }
  }
  return { done, total };
}

function buildFilterContextLabel(
  projects: ProjectItem[],
  selectedProjectIds: string[],
  selectedCategory: CalendarCategory | '전체'
): string {
  const byId = new Map(projects.map((p) => [p.id, p]));
  let projectPart = '전체 프로젝트';
  if (selectedProjectIds.length === 1) {
    const single = byId.get(selectedProjectIds[0]);
    if (single) {
      projectPart = single.code ? `${single.name} (${single.code})` : single.name;
    }
  } else if (selectedProjectIds.length >= 2) {
    const names = selectedProjectIds
      .map((id) => byId.get(id))
      .filter((p): p is ProjectItem => Boolean(p))
      .map((p) => p.code || p.name);
    projectPart = `프로젝트 비교 (${selectedProjectIds.length}개: ${names.slice(0, 3).join(' · ')}${
      names.length > 3 ? ' 외' : ''
    })`;
  }

  const categoryPart = selectedCategory === '전체' ? '전체 분류' : `분류: ${selectedCategory}`;
  return `${projectPart}  ·  ${categoryPart}`;
}

function drawExecutiveHeader(
  ctx: CanvasRenderingContext2D,
  palette: ThemePalette,
  params: {
    kicker: string;
    title: string;
    filterSummary: string;
    metricsLine: string;
    legendProjects: ProjectItem[];
  }
): number {
  const contentW = PAGE_W - MARGIN_X * 2;
  const topY = MARGIN_TOP;

  // 좌측 상단 Kicker
  ctx.font = `600 20px ${FONT_SANS}`;
  ctx.fillStyle = palette.accentGold;
  ctx.textAlign = 'left';
  ctx.fillText(params.kicker, MARGIN_X, topY + 12);

  // 좌측 메인 타이틀
  ctx.font = `700 48px ${FONT_SANS}`;
  ctx.fillStyle = palette.textPrimary;
  ctx.fillText(params.title, MARGIN_X, topY + 66);

  // 우측 필터 요약 및 핵심 지표 (Unboxed Zero-Pill)
  ctx.textAlign = 'right';
  ctx.font = `500 21px ${FONT_SANS}`;
  ctx.fillStyle = palette.textSecondary;
  ctx.fillText(
    truncateText(ctx, params.filterSummary, contentW * 0.52),
    PAGE_W - MARGIN_X,
    topY + 26
  );

  ctx.font = `500 21px ${FONT_MONO}`;
  ctx.fillStyle = palette.textMuted;
  ctx.fillText(params.metricsLine, PAGE_W - MARGIN_X, topY + 66);

  let dividerY = topY + 106;

  // 프로젝트 컬러 범례 스트립 (최대 6개)
  if (params.legendProjects.length > 0) {
    const visibleProjects = params.legendProjects.slice(0, 6);
    let cursorX = MARGIN_X;
    const legendY = topY + 114;

    ctx.textAlign = 'left';
    for (let i = 0; i < visibleProjects.length; i++) {
      const proj = visibleProjects[i];
      ctx.beginPath();
      ctx.arc(cursorX + 7, legendY, 6.5, 0, Math.PI * 2);
      ctx.fillStyle = proj.color || palette.accentGold;
      ctx.fill();

      cursorX += 22;
      ctx.font = `500 18px ${FONT_SANS}`;
      ctx.fillStyle = palette.textSecondary;
      const label = proj.code ? `${proj.name} (${proj.code})` : proj.name;
      const clamped = truncateText(ctx, label, 280);
      ctx.fillText(clamped, cursorX, legendY);
      cursorX += ctx.measureText(clamped).width + 28;

      if (cursorX > PAGE_W - MARGIN_X - 240) break;
    }

    dividerY = topY + 144;
  }

  // 하단 헤어라인 구분선
  ctx.beginPath();
  ctx.moveTo(MARGIN_X, dividerY);
  ctx.lineTo(PAGE_W - MARGIN_X, dividerY);
  ctx.strokeStyle = palette.borderStrong;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  return dividerY + 22;
}

function stampPageFooters(
  pages: Array<{ canvas: HTMLCanvasElement; sectionLabel: string }>,
  palette: ThemePalette
) {
  const now = new Date();
  const stamp = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(
    now.getDate()
  ).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(
    now.getMinutes()
  ).padStart(2, '0')}`;
  const total = pages.length;

  pages.forEach(({ canvas, sectionLabel }, idx) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.beginPath();
    ctx.moveTo(MARGIN_X, FOOTER_Y - 22);
    ctx.lineTo(PAGE_W - MARGIN_X, FOOTER_Y - 22);
    ctx.strokeStyle = palette.borderSubtle;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = `500 18px ${FONT_SANS}`;
    ctx.fillStyle = palette.textMuted;
    ctx.fillText(`바이브 행사  ·  ${sectionLabel}`, MARGIN_X, FOOTER_Y + 4);

    ctx.textAlign = 'right';
    ctx.font = `500 18px ${FONT_MONO}`;
    ctx.fillStyle = palette.textMuted;
    const pageNo = `${String(idx + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
    ctx.fillText(`생성 ${stamp}  ·  PAGE ${pageNo}`, PAGE_W - MARGIN_X, FOOTER_Y + 4);
  });
}

/**
 * 1. 월간 캘린더 그리드 페이지 렌더링
 */
function renderMonthGridCanvas(
  options: PdfExportOptions,
  palette: ThemePalette,
  monthEvents: CalendarEventItem[]
): HTMLCanvasElement {
  const { canvas, ctx } = createPageCanvas(palette);
  const { currentYear, currentMonth, selectedDate, events, projects, selectedProjectIds, selectedCategory } =
    options;

  const projectById = new Map(projects.map((p) => [p.id, p]));
  const stats = calculateCompletionStats(monthEvents);
  const checkStats = computeChecklistStats(monthEvents);

  const usedProjectIds = new Set(
    monthEvents.map((e) => e.projectId).filter((id): id is string => Boolean(id))
  );
  const legendProjects =
    selectedProjectIds.length > 0
      ? selectedProjectIds
          .map((id) => projectById.get(id))
          .filter((p): p is ProjectItem => Boolean(p))
      : projects.filter((p) => usedProjectIds.has(p.id));

  const metricsLine = [
    `일정 ${stats.total}건`,
    `완료 ${stats.completed}건 (${stats.rate}%)`,
    checkStats.total > 0 ? `체크리스트 ${checkStats.done}/${checkStats.total}` : null,
  ]
    .filter(Boolean)
    .join('  ·  ');

  const gridTop = drawExecutiveHeader(ctx, palette, {
    kicker: '바이브 행사  ·  월간 공정 캘린더',
    title: `${currentYear}년 ${currentMonth + 1}월`,
    filterSummary: buildFilterContextLabel(projects, selectedProjectIds, selectedCategory),
    metricsLine,
    legendProjects,
  });

  const grid = getCalendarGrid(currentYear, currentMonth);
  const rowCount = Math.ceil(grid.length / 7) || 5;

  const contentW = PAGE_W - MARGIN_X * 2;
  const colW = contentW / 7;
  const weekdayHeaderH = 48;
  const gridBodyTop = gridTop + weekdayHeaderH;
  const gridBodyH = FOOTER_Y - 38 - gridBodyTop;
  const cellH = gridBodyH / rowCount;

  // 요일 헤더 배경
  drawRoundedRect(ctx, MARGIN_X, gridTop, contentW, weekdayHeaderH, 10);
  ctx.fillStyle = palette.headerStripBg;
  ctx.fill();

  for (let col = 0; col < 7; col++) {
    const cx = MARGIN_X + col * colW + colW / 2;
    ctx.font = `600 20px ${FONT_SANS}`;
    ctx.textAlign = 'center';
    ctx.fillStyle =
      col === 0
        ? palette.textSunday
        : col === 6
        ? palette.textSaturday
        : palette.textSecondary;
    ctx.fillText(WEEKDAYS_KO[col], cx, gridTop + weekdayHeaderH / 2);
  }

  // 날짜별 이벤트 매핑 (전체 필터 이벤트 기준)
  const eventsByDate = new Map<string, CalendarEventItem[]>();
  for (const ev of events) {
    const list = eventsByDate.get(ev.date) || [];
    list.push(ev);
    eventsByDate.set(ev.date, list);
  }

  // 그리드 외곽선 및 셀 렌더링
  const maxChipsPerCell = rowCount >= 6 ? 3 : 4;
  const chipH = rowCount >= 6 ? 35 : 38;
  const chipGap = 6;

  grid.forEach((cell, idx) => {
    const row = Math.floor(idx / 7);
    const col = idx % 7;
    const x = MARGIN_X + col * colW;
    const y = gridBodyTop + row * cellH;

    // 셀 배경
    ctx.fillStyle = cell.isCurrentMonth ? palette.surfaceBg : palette.surfaceMutedBg;
    ctx.fillRect(x, y, colW, cellH);

    // 셀 테두리
    ctx.strokeStyle = palette.borderSubtle;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, colW, cellH);

    // 선택된 날짜 강조 보더
    if (cell.date === selectedDate) {
      ctx.save();
      ctx.strokeStyle = palette.selectedCellStroke;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1.5, y + 1.5, colW - 3, cellH - 3);
      ctx.restore();
    }

    const dayEvents = sortEventsChronologically(eventsByDate.get(cell.date) || []);

    // 날짜 숫자 표시
    const numY = y + 26;
    if (cell.isToday) {
      drawRoundedRect(ctx, x + 12, y + 9, 44, 32, 8);
      ctx.fillStyle = palette.todayBadgeBg;
      ctx.fill();

      ctx.font = `700 20px ${FONT_MONO}`;
      ctx.fillStyle = palette.todayBadgeText;
      ctx.textAlign = 'center';
      ctx.fillText(String(cell.dayNumber), x + 34, numY);
    } else {
      ctx.font = `${cell.isCurrentMonth ? 600 : 400} 20px ${FONT_MONO}`;
      ctx.textAlign = 'left';
      if (!cell.isCurrentMonth) {
        ctx.fillStyle = palette.textDim;
      } else if (col === 0) {
        ctx.fillStyle = palette.textSunday;
      } else if (col === 6) {
        ctx.fillStyle = palette.textSaturday;
      } else {
        ctx.fillStyle = palette.textPrimary;
      }
      ctx.fillText(String(cell.dayNumber), x + 16, numY);
    }

    // 일일 건수 보조 표기
    if (dayEvents.length > 0 && cell.isCurrentMonth) {
      ctx.font = `500 16px ${FONT_MONO}`;
      ctx.fillStyle = palette.textDim;
      ctx.textAlign = 'right';
      ctx.fillText(`${dayEvents.length}`, x + colW - 14, numY);
    }

    // 일정 칩 렌더링
    const hasOverflow = dayEvents.length > maxChipsPerCell;
    const renderLimit = hasOverflow ? maxChipsPerCell - 1 : maxChipsPerCell;
    const visibleEvents = dayEvents.slice(0, renderLimit);

    visibleEvents.forEach((ev, evIdx) => {
      const cy = y + 48 + evIdx * (chipH + chipGap);
      const cw = colW - 20;
      const cx = x + 10;
      const accentHex = getEventAccentHex(ev, projectById);

      ctx.save();
      if (!cell.isCurrentMonth) {
        ctx.globalAlpha = 0.48;
      } else if (ev.isCompleted) {
        ctx.globalAlpha = 0.68;
      }

      drawRoundedRect(ctx, cx, cy, cw, chipH, 7);
      ctx.fillStyle = hexToRgba(accentHex, palette.chipFillAlpha);
      ctx.fill();
      ctx.strokeStyle = hexToRgba(accentHex, palette.chipStrokeAlpha);
      ctx.lineWidth = 1;
      ctx.stroke();

      // 프로젝트/분류 도트
      ctx.beginPath();
      ctx.arc(cx + 13, cy + chipH / 2, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = accentHex;
      ctx.fill();

      // 시간 텍스트
      const timeLabel = ev.isAllDay ? '종일' : ev.startTime || '';
      ctx.font = `500 16px ${FONT_MONO}`;
      ctx.fillStyle = palette.textSecondary;
      ctx.textAlign = 'left';
      ctx.fillText(timeLabel, cx + 24, cy + chipH / 2 + 0.5);
      const timeW = timeLabel ? ctx.measureText(timeLabel).width + 10 : 0;

      // 제목 텍스트
      const prefixDone = ev.isCompleted ? '✓ ' : '';
      const titleMaxW = cw - 34 - timeW;
      ctx.font = `500 17px ${FONT_SANS}`;
      ctx.fillStyle = palette.textPrimary;
      ctx.fillText(
        truncateText(ctx, `${prefixDone}${ev.title}`, titleMaxW),
        cx + 24 + timeW,
        cy + chipH / 2 + 0.5
      );

      ctx.restore();
    });

    if (hasOverflow) {
      const moreCount = dayEvents.length - renderLimit;
      const oy = y + 48 + renderLimit * (chipH + chipGap) + chipH / 2;
      ctx.font = `500 16px ${FONT_MONO}`;
      ctx.fillStyle = palette.textMuted;
      ctx.textAlign = 'left';
      ctx.fillText(`+${moreCount}건 더보기 (명세 참조)`, x + 16, oy);
    }
  });

  return canvas;
}

/**
 * 2. 주간 타임라인 및 종일 매트릭스 페이지 렌더링
 */
function renderWeekTimelineCanvas(
  options: PdfExportOptions,
  palette: ThemePalette,
  weekEvents: CalendarEventItem[]
): HTMLCanvasElement {
  const { canvas, ctx } = createPageCanvas(palette);
  const { selectedDate, projects, selectedProjectIds, selectedCategory } = options;

  const weekDays = getWeekDays(selectedDate);
  const weekYear = parseLocalDate(weekDays[0].date).getFullYear();
  const projectById = new Map(projects.map((p) => [p.id, p]));

  const stats = calculateCompletionStats(weekEvents);
  const checkStats = computeChecklistStats(weekEvents);
  const allDayTotal = weekEvents.filter((e) => e.isAllDay).length;

  const usedProjectIds = new Set(
    weekEvents.map((e) => e.projectId).filter((id): id is string => Boolean(id))
  );
  const legendProjects =
    selectedProjectIds.length > 0
      ? selectedProjectIds
          .map((id) => projectById.get(id))
          .filter((p): p is ProjectItem => Boolean(p))
      : projects.filter((p) => usedProjectIds.has(p.id));

  const metricsLine = [
    `주간 일정 ${stats.total}건`,
    allDayTotal > 0 ? `종일 ${allDayTotal}건` : null,
    `완료 ${stats.completed}건 (${stats.rate}%)`,
    checkStats.total > 0 ? `체크리스트 ${checkStats.done}/${checkStats.total}` : null,
  ]
    .filter(Boolean)
    .join('  ·  ');

  const gridTop = drawExecutiveHeader(ctx, palette, {
    kicker: '바이브 행사  ·  주간 타임라인 브리프',
    title: `${weekYear}년 ${getWeekRangeLabel(selectedDate)}`,
    filterSummary: buildFilterContextLabel(projects, selectedProjectIds, selectedCategory),
    metricsLine,
    legendProjects,
  });

  // 요일별 종일/시간제 일정 분리
  const allDayByDate = new Map<string, CalendarEventItem[]>();
  const timedByDate = new Map<string, CalendarEventItem[]>();
  for (const d of weekDays) {
    allDayByDate.set(d.date, []);
    timedByDate.set(d.date, []);
  }
  for (const ev of weekEvents) {
    if (ev.isAllDay) {
      allDayByDate.get(ev.date)?.push(ev);
    } else {
      timedByDate.get(ev.date)?.push(ev);
    }
  }

  // 동적 시간 범위 산출 (기본 08:00 ~ 20:00, 이른/늦은 일정 자동 확장)
  let startHour = 8;
  let endHour = 20;
  for (const ev of weekEvents) {
    if (ev.isAllDay) continue;
    const sMin = timeToMinutes(ev.startTime);
    const eMin = Math.max(sMin + 30, timeToMinutes(ev.endTime));
    startHour = Math.min(startHour, Math.max(0, Math.floor(sMin / 60)));
    endHour = Math.max(endHour, Math.min(24, Math.ceil(eMin / 60)));
  }
  if (endHour - startHour < 10) {
    endHour = Math.min(24, startHour + 10);
  }
  const hourSpan = Math.max(1, endHour - startHour);

  const timeGutterW = 122;
  const contentW = PAGE_W - MARGIN_X * 2;
  const dayAreaX = MARGIN_X + timeGutterW;
  const dayColW = (contentW - timeGutterW) / 7;

  // 상단 요일 헤더
  const dayHeaderH = 62;
  drawRoundedRect(ctx, MARGIN_X, gridTop, contentW, dayHeaderH, 10);
  ctx.fillStyle = palette.headerStripBg;
  ctx.fill();

  ctx.font = `500 17px ${FONT_MONO}`;
  ctx.fillStyle = palette.textMuted;
  ctx.textAlign = 'center';
  ctx.fillText('TIME', MARGIN_X + timeGutterW / 2, gridTop + dayHeaderH / 2);

  weekDays.forEach((day, colIdx) => {
    const colX = dayAreaX + colIdx * dayColW;
    const centerX = colX + dayColW / 2;

    if (day.date === selectedDate) {
      ctx.fillStyle = hexToRgba(palette.accentGold, 0.12);
      ctx.fillRect(colX, gridTop, dayColW, dayHeaderH);
    }

    const labelColor =
      colIdx === 0
        ? palette.textSunday
        : colIdx === 6
        ? palette.textSaturday
        : palette.textPrimary;

    ctx.font = `600 19px ${FONT_SANS}`;
    ctx.fillStyle = labelColor;
    ctx.textAlign = 'center';
    const datePart = `${String(day.monthNumber).padStart(2, '0')}.${String(day.dayNumber).padStart(
      2,
      '0'
    )}`;
    ctx.fillText(`${day.dayOfWeek}  ${datePart}`, centerX, gridTop + dayHeaderH / 2);

    ctx.beginPath();
    ctx.moveTo(colX, gridTop + 10);
    ctx.lineTo(colX, gridTop + dayHeaderH - 10);
    ctx.strokeStyle = palette.borderSubtle;
    ctx.lineWidth = 1;
    ctx.stroke();
  });

  let currentY = gridTop + dayHeaderH;

  // 종일(All-Day) 스트립 (존재할 때만 표시)
  let maxAllDayRows = 0;
  allDayByDate.forEach((list) => {
    maxAllDayRows = Math.max(maxAllDayRows, Math.min(2, list.length));
  });

  if (maxAllDayRows > 0) {
    const allDayRowH = maxAllDayRows === 1 ? 54 : 90;
    ctx.fillStyle = palette.surfaceAltBg;
    ctx.fillRect(MARGIN_X, currentY, contentW, allDayRowH);
    ctx.strokeStyle = palette.borderSubtle;
    ctx.lineWidth = 1;
    ctx.strokeRect(MARGIN_X, currentY, contentW, allDayRowH);

    ctx.font = `500 17px ${FONT_SANS}`;
    ctx.fillStyle = palette.textMuted;
    ctx.textAlign = 'center';
    ctx.fillText('종일', MARGIN_X + timeGutterW / 2, currentY + allDayRowH / 2);

    weekDays.forEach((day, colIdx) => {
      const colX = dayAreaX + colIdx * dayColW;
      ctx.beginPath();
      ctx.moveTo(colX, currentY);
      ctx.lineTo(colX, currentY + allDayRowH);
      ctx.strokeStyle = palette.borderSubtle;
      ctx.stroke();

      const items = allDayByDate.get(day.date) || [];
      items.slice(0, 2).forEach((ev, idx) => {
        const chipY = currentY + 8 + idx * 38;
        const accentHex = getEventAccentHex(ev, projectById);
        drawRoundedRect(ctx, colX + 8, chipY, dayColW - 16, 33, 6);
        ctx.fillStyle = hexToRgba(accentHex, palette.chipFillAlpha);
        ctx.fill();
        ctx.strokeStyle = hexToRgba(accentHex, palette.chipStrokeAlpha);
        ctx.stroke();

        ctx.font = `600 16px ${FONT_SANS}`;
        ctx.fillStyle = palette.textPrimary;
        ctx.textAlign = 'left';
        ctx.fillText(
          truncateText(ctx, `${ev.isCompleted ? '✓ ' : ''}${ev.title}`, dayColW - 32),
          colX + 16,
          chipY + 16.5
        );
      });
    });

    currentY += allDayRowH;
  }

  // 시간 그리드 본문
  const timelineH = FOOTER_Y - 38 - currentY;
  const pxPerHour = timelineH / hourSpan;

  ctx.fillStyle = palette.surfaceBg;
  ctx.fillRect(MARGIN_X, currentY, contentW, timelineH);
  ctx.strokeStyle = palette.borderSubtle;
  ctx.lineWidth = 1;
  ctx.strokeRect(MARGIN_X, currentY, contentW, timelineH);

  // 선택 요일 컬럼 미세 하이라이트 & 세로 구분선
  weekDays.forEach((day, colIdx) => {
    const colX = dayAreaX + colIdx * dayColW;
    if (day.date === selectedDate) {
      ctx.fillStyle = hexToRgba(palette.accentGold, 0.04);
      ctx.fillRect(colX, currentY, dayColW, timelineH);
    }
    ctx.beginPath();
    ctx.moveTo(colX, currentY);
    ctx.lineTo(colX, currentY + timelineH);
    ctx.strokeStyle = palette.borderSubtle;
    ctx.lineWidth = 1;
    ctx.stroke();
  });

  // 가로 시간 눈금선 및 좌측 시각 레이블
  for (let h = 0; h <= hourSpan; h++) {
    const hourVal = startHour + h;
    const lineY = currentY + h * pxPerHour;

    if (h > 0 && h < hourSpan) {
      ctx.beginPath();
      ctx.moveTo(dayAreaX, lineY);
      ctx.lineTo(PAGE_W - MARGIN_X, lineY);
      ctx.strokeStyle = palette.borderSubtle;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    if (h < hourSpan) {
      // 30분 보조선
      const halfY = lineY + pxPerHour / 2;
      ctx.save();
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(dayAreaX, halfY);
      ctx.lineTo(PAGE_W - MARGIN_X, halfY);
      ctx.strokeStyle = palette.borderFaint;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();

      ctx.font = `500 17px ${FONT_MONO}`;
      ctx.fillStyle = palette.textMuted;
      ctx.textAlign = 'right';
      ctx.fillText(
        `${String(hourVal).padStart(2, '0')}:00`,
        MARGIN_X + timeGutterW - 18,
        lineY + 18
      );
    }
  }

  // 각 요일별 시간제 일정 블록 렌더링 (timeGridLayout 재사용)
  ctx.save();
  ctx.beginPath();
  ctx.rect(dayAreaX, currentY, contentW - timeGutterW, timelineH);
  ctx.clip();

  weekDays.forEach((day, colIdx) => {
    const colX = dayAreaX + colIdx * dayColW;
    const dayTimed = timedByDate.get(day.date) || [];
    const positioned = layoutTimeEvents(dayTimed, startHour, pxPerHour);

    for (const pos of positioned) {
      const ev = pos.event;
      const laneW = (dayColW - 12) / pos.totalColumns;
      const bx = colX + 6 + pos.column * laneW;
      const bw = Math.max(24, laneW - 4);
      const by = Math.max(currentY + 2, currentY + pos.topPx + 1);
      const bh = Math.min(
        currentY + timelineH - by - 2,
        Math.max(30, pos.heightPx - 2)
      );
      if (bh <= 8) continue;

      const accentHex = getEventAccentHex(ev, projectById);
      const proj = ev.projectId ? projectById.get(ev.projectId) : undefined;

      drawRoundedRect(ctx, bx, by, bw, bh, 8);
      ctx.fillStyle =
        palette.mode === 'obsidian'
          ? hexToRgba(accentHex, 0.22)
          : hexToRgba(accentHex, 0.13);
      ctx.fill();
      ctx.strokeStyle = hexToRgba(accentHex, 0.55);
      ctx.lineWidth = 1.2;
      ctx.stroke();

      const innerPad = 10;
      const textMaxW = bw - innerPad * 2;
      if (textMaxW <= 12) continue;

      if (bh < 52) {
        // 컴팩트 1줄 표시
        ctx.font = `600 15px ${FONT_SANS}`;
        ctx.fillStyle = palette.textPrimary;
        ctx.textAlign = 'left';
        const oneLine = `${ev.startTime} ${ev.isCompleted ? '✓ ' : ''}${ev.title}`;
        ctx.fillText(truncateText(ctx, oneLine, textMaxW), bx + innerPad, by + bh / 2);
      } else {
        // 시간 + 프로젝트 코드
        ctx.font = `500 14px ${FONT_MONO}`;
        ctx.fillStyle = palette.textSecondary;
        ctx.textAlign = 'left';
        const timeStr = `${ev.startTime}–${ev.endTime}`;
        const headerMeta = proj?.code ? `${timeStr} · ${proj.code}` : timeStr;
        ctx.fillText(truncateText(ctx, headerMeta, textMaxW), bx + innerPad, by + 18);

        // 일정 제목
        ctx.font = `600 16px ${FONT_SANS}`;
        ctx.fillStyle = palette.textPrimary;
        ctx.fillText(
          truncateText(ctx, `${ev.isCompleted ? '✓ ' : ''}${ev.title}`, textMaxW),
          bx + innerPad,
          by + 40
        );

        // 여유 높이가 있을 때 장소 또는 체크리스트 진행률 표시
        if (bh >= 76) {
          const checkTotal = ev.checklist?.length || 0;
          const checkDone = ev.checklist?.filter((c) => c.done).length || 0;
          const combinedLoc = formatCombinedLocation(ev.location, ev.locationAddress);
          const subMeta = [
            combinedLoc || null,
            checkTotal > 0 ? `체크리스트 ${checkDone}/${checkTotal}` : null,
          ]
            .filter(Boolean)
            .join(' · ');

          if (subMeta) {
            ctx.font = `400 14px ${FONT_SANS}`;
            ctx.fillStyle = palette.textMuted;
            ctx.fillText(truncateText(ctx, subMeta, textMaxW), bx + innerPad, by + 62);
          }
        }
      }
    }
  });

  ctx.restore();

  // 주간 일정이 비어 있는 경우 중앙 안내 문구
  if (weekEvents.length === 0) {
    ctx.font = `500 22px ${FONT_SANS}`;
    ctx.fillStyle = palette.textMuted;
    ctx.textAlign = 'center';
    ctx.fillText(
      '선택된 주간 및 필터 조건에 등록된 일정이 없습니다.',
      dayAreaX + (contentW - timeGutterW) / 2,
      currentY + timelineH / 2
    );
  }

  return canvas;
}

/**
 * 3. 상세 일정 및 체크리스트 명세표 페이지 (자동 다중 페이지 분할)
 */
function renderScheduleLedgerCanvases(
  options: PdfExportOptions,
  palette: ThemePalette,
  targetEvents: CalendarEventItem[],
  ledgerTitle: string,
  ledgerKicker: string
): HTMLCanvasElement[] {
  const sorted = sortEventsChronologically(targetEvents);
  if (sorted.length === 0) return [];

  const ROWS_PER_PAGE = 12;
  const pageChunks: CalendarEventItem[][] = [];
  for (let i = 0; i < sorted.length; i += ROWS_PER_PAGE) {
    pageChunks.push(sorted.slice(i, i + ROWS_PER_PAGE));
  }

  const { projects, selectedProjectIds, selectedCategory } = options;
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const stats = calculateCompletionStats(sorted);
  const checkStats = computeChecklistStats(sorted);

  return pageChunks.map((chunk, chunkIdx) => {
    const { canvas, ctx } = createPageCanvas(palette);

    const subPageSuffix =
      pageChunks.length > 1 ? ` (${chunkIdx + 1}/${pageChunks.length})` : '';
    const metricsLine = [
      `총 ${stats.total}건`,
      `완료 ${stats.completed}건 (${stats.rate}%)`,
      checkStats.total > 0 ? `체크리스트 ${checkStats.done}/${checkStats.total}` : null,
    ]
      .filter(Boolean)
      .join('  ·  ');

    const tableTop = drawExecutiveHeader(ctx, palette, {
      kicker: ledgerKicker,
      title: `${ledgerTitle}${subPageSuffix}`,
      filterSummary: buildFilterContextLabel(projects, selectedProjectIds, selectedCategory),
      metricsLine,
      legendProjects: [],
    });

    const contentW = PAGE_W - MARGIN_X * 2;
    const colWidths = {
      date: 220,
      time: 220,
      title: 920,
      project: 490,
      status: contentW - (220 + 220 + 920 + 490),
    };

    const colX = {
      date: MARGIN_X,
      time: MARGIN_X + colWidths.date,
      title: MARGIN_X + colWidths.date + colWidths.time,
      project: MARGIN_X + colWidths.date + colWidths.time + colWidths.title,
      status:
        MARGIN_X + colWidths.date + colWidths.time + colWidths.title + colWidths.project,
    };

    // 테이블 컬럼 헤더
    const thH = 50;
    drawRoundedRect(ctx, MARGIN_X, tableTop, contentW, thH, 8);
    ctx.fillStyle = palette.headerStripBg;
    ctx.fill();

    ctx.font = `600 18px ${FONT_SANS}`;
    ctx.fillStyle = palette.textSecondary;
    ctx.textAlign = 'left';
    ctx.fillText('일자 · 요일', colX.date + 20, tableTop + thH / 2);
    ctx.fillText('시간', colX.time + 16, tableTop + thH / 2);
    ctx.fillText('일정명 · 장소 및 준비 사항', colX.title + 16, tableTop + thH / 2);
    ctx.fillText('프로젝트 · 분류', colX.project + 16, tableTop + thH / 2);
    ctx.textAlign = 'right';
    ctx.fillText('진행 상태 · 체크리스트', MARGIN_X + contentW - 20, tableTop + thH / 2);

    const bodyTop = tableTop + thH + 8;
    const availableH = FOOTER_Y - 40 - bodyTop;
    const rowH = Math.min(104, availableH / ROWS_PER_PAGE);

    chunk.forEach((ev, rowIdx) => {
      const ry = bodyTop + rowIdx * rowH;
      const midY = ry + rowH / 2;

      if (rowIdx % 2 === 1) {
        ctx.fillStyle = palette.surfaceAltBg;
        ctx.fillRect(MARGIN_X, ry, contentW, rowH);
      }

      ctx.beginPath();
      ctx.moveTo(MARGIN_X, ry + rowH);
      ctx.lineTo(MARGIN_X + contentW, ry + rowH);
      ctx.strokeStyle = palette.borderSubtle;
      ctx.lineWidth = 1;
      ctx.stroke();

      const accentHex = getEventAccentHex(ev, projectById);
      const proj = ev.projectId ? projectById.get(ev.projectId) : undefined;
      const dow = getDayOfWeekShort(ev.date);

      // 1) 일자 · 요일
      ctx.font = `600 19px ${FONT_MONO}`;
      ctx.fillStyle = palette.textPrimary;
      ctx.textAlign = 'left';
      ctx.fillText(`${ev.date.slice(5).replace('-', '.')} (${dow})`, colX.date + 20, midY);

      // 2) 시간
      ctx.font = `500 18px ${FONT_MONO}`;
      ctx.fillStyle = palette.textSecondary;
      const timeStr = ev.isAllDay ? '종일' : `${ev.startTime} – ${ev.endTime}`;
      ctx.fillText(timeStr, colX.time + 16, midY);

      // 3) 일정명 + 보조 정보(장소/체크리스트 요약)
      const subParts: string[] = [];
      const fullLoc = formatCombinedLocation(ev.location, ev.locationAddress);
      if (fullLoc) subParts.push(`장소: ${fullLoc}`);
      if (ev.checklist && ev.checklist.length > 0) {
        const previewItems = ev.checklist
          .slice(0, 3)
          .map((c) => `${c.done ? '✓' : '□'} ${c.text}`)
          .join('  ·  ');
        subParts.push(previewItems);
      } else if (ev.content) {
        subParts.push(ev.content.replace(/\s+/g, ' ').trim());
      }

      if (subParts.length > 0) {
        ctx.font = `600 20px ${FONT_SANS}`;
        ctx.fillStyle = palette.textPrimary;
        ctx.fillText(
          truncateText(ctx, ev.title, colWidths.title - 36),
          colX.title + 16,
          ry + rowH * 0.36
        );

        ctx.font = `400 16px ${FONT_SANS}`;
        ctx.fillStyle = palette.textMuted;
        ctx.fillText(
          truncateText(ctx, subParts.join('   |   '), colWidths.title - 36),
          colX.title + 16,
          ry + rowH * 0.7
        );
      } else {
        ctx.font = `600 20px ${FONT_SANS}`;
        ctx.fillStyle = palette.textPrimary;
        ctx.fillText(
          truncateText(ctx, ev.title, colWidths.title - 36),
          colX.title + 16,
          midY
        );
      }

      // 4) 프로젝트 · 분류
      ctx.beginPath();
      ctx.arc(colX.project + 24, midY, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = accentHex;
      ctx.fill();

      ctx.font = `500 18px ${FONT_SANS}`;
      ctx.fillStyle = palette.textSecondary;
      const projLabel = proj
        ? `${proj.code ? `${proj.code} · ` : ''}${proj.name}  ·  ${ev.category}`
        : `미지정  ·  ${ev.category}`;
      ctx.fillText(
        truncateText(ctx, projLabel, colWidths.project - 48),
        colX.project + 38,
        midY
      );

      // 5) 진행 상태 · 체크리스트 수치
      const cTotal = ev.checklist?.length || 0;
      const cDone = ev.checklist?.filter((c) => c.done).length || 0;
      const statusText = ev.isCompleted ? '완료됨' : '진행 예정';
      const checkLabel = cTotal > 0 ? `  ·  ${cDone}/${cTotal}` : '';

      ctx.textAlign = 'right';
      ctx.font = `600 18px ${FONT_MONO}`;
      ctx.fillStyle = ev.isCompleted ? palette.completedColor : palette.textSecondary;
      ctx.fillText(
        `${statusText}${checkLabel}`,
        MARGIN_X + contentW - 20,
        cTotal > 0 ? ry + rowH * 0.38 : midY
      );

      if (cTotal > 0) {
        const barW = 140;
        const barH = 7;
        const barX = MARGIN_X + contentW - 20 - barW;
        const barY = ry + rowH * 0.66;
        const ratio = Math.min(1, Math.max(0, cDone / cTotal));

        drawRoundedRect(ctx, barX, barY, barW, barH, 3.5);
        ctx.fillStyle = palette.borderStrong;
        ctx.fill();

        if (ratio > 0) {
          drawRoundedRect(ctx, barX, barY, Math.max(8, barW * ratio), barH, 3.5);
          ctx.fillStyle = ev.isCompleted ? palette.completedColor : accentHex;
          ctx.fill();
        }
      }
    });

    return canvas;
  });
}

function downloadPdfBlob(pdf: jsPDF, filename: string): void {
  const safeName = filename.replace(/[\\/:*?"<>|]/g, '_').trim() || 'vibe-calendar.pdf';
  const finalName = safeName.endsWith('.pdf') ? safeName : `${safeName}.pdf`;
  const blob = pdf.output('blob');
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.setAttribute('download', finalName);
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 월간 / 주간 / 통합 뷰 데이터를 고해상도 A4 가로형 PDF 문서로 생성 및 즉시 다운로드
 */
export async function exportCalendarViewToPdf(
  options: PdfExportOptions
): Promise<PdfExportResult> {
  if (typeof document !== 'undefined' && 'fonts' in document) {
    try {
      await Promise.race([
        document.fonts.ready,
        new Promise((resolve) => setTimeout(resolve, 600)),
      ]);
    } catch {
      // 폰트 대기 실패 시 즉시 진행
    }
  }

  const palette = PALETTES[options.theme] || PALETTES.obsidian;
  const monthPrefix = `${options.currentYear}-${String(options.currentMonth + 1).padStart(
    2,
    '0'
  )}`;
  const monthEvents = options.events.filter((e) => e.date.startsWith(monthPrefix));

  const weekDays = getWeekDays(options.selectedDate);
  const weekDateSet = new Set(weekDays.map((d) => d.date));
  const weekEvents = options.events.filter((e) => weekDateSet.has(e.date));

  const renderedPages: Array<{ canvas: HTMLCanvasElement; sectionLabel: string }> = [];

  if (options.scope === 'month' || options.scope === 'both') {
    const monthGridCanvas = renderMonthGridCanvas(options, palette, monthEvents);
    renderedPages.push({
      canvas: monthGridCanvas,
      sectionLabel: `${options.currentYear}년 ${options.currentMonth + 1}월 월간 캘린더`,
    });

    const monthLedgerPages = renderScheduleLedgerCanvases(
      options,
      palette,
      monthEvents,
      `${options.currentYear}년 ${options.currentMonth + 1}월 상세 일정 명세`,
      '바이브 행사  ·  월간 세부 공정 및 체크리스트'
    );
    monthLedgerPages.forEach((c) => {
      renderedPages.push({
        canvas: c,
        sectionLabel: `${options.currentYear}년 ${options.currentMonth + 1}월 상세 일정 명세`,
      });
    });
  }

  if (options.scope === 'week' || options.scope === 'both') {
    const weekLabel = getWeekRangeLabel(options.selectedDate);
    const weekGridCanvas = renderWeekTimelineCanvas(options, palette, weekEvents);
    renderedPages.push({
      canvas: weekGridCanvas,
      sectionLabel: `주간 타임라인 (${weekLabel})`,
    });

    const weekLedgerPages = renderScheduleLedgerCanvases(
      options,
      palette,
      weekEvents,
      `주간 상세 공정 및 체크리스트 (${weekLabel})`,
      '바이브 행사  ·  주간 실행 명세표'
    );
    weekLedgerPages.forEach((c) => {
      renderedPages.push({
        canvas: c,
        sectionLabel: `주간 실행 명세표 (${weekLabel})`,
      });
    });
  }

  stampPageFooters(renderedPages, palette);

  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const docTitle =
    options.scope === 'month'
      ? `바이브 행사 월간 일정표 (${monthPrefix})`
      : options.scope === 'week'
      ? `바이브 행사 주간 타임라인 (${weekDays[0].date} ~ ${weekDays[6].date})`
      : `바이브 행사 월간·주간 통합 브리프 (${monthPrefix})`;

  pdf.setProperties({
    title: docTitle,
    subject: '행사 준비 공정 및 일정 리포트',
    creator: '바이브 행사',
  });

  renderedPages.forEach(({ canvas }, index) => {
    if (index > 0) {
      pdf.addPage('a4', 'landscape');
    }
    const imgData = canvas.toDataURL('image/jpeg', 0.94);
    pdf.addImage(imgData, 'JPEG', 0, 0, 297, 210, undefined, 'FAST');
  });

  const todayStr = getTodayDateString();
  const filename =
    options.scope === 'month'
      ? `바이브행사_월간일정_${monthPrefix}.pdf`
      : options.scope === 'week'
      ? `바이브행사_주간일정_${weekDays[0].date}_${weekDays[6].date}.pdf`
      : `바이브행사_월간주간통합_${monthPrefix}_${todayStr}.pdf`;

  downloadPdfBlob(pdf, filename);

  const exportedEventCount =
    options.scope === 'month'
      ? monthEvents.length
      : options.scope === 'week'
      ? weekEvents.length
      : new Set([...monthEvents.map((e) => e.id), ...weekEvents.map((e) => e.id)]).size;

  return {
    filename,
    pageCount: renderedPages.length,
    eventCount: exportedEventCount,
  };
}
