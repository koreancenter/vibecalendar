import React, { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  Clock,
  MapPin,
  Trash2,
  CheckCircle,
  Circle,
  CheckSquare,
  Square,
  Download,
  AlertTriangle,
  X,
  FileText,
  ListTodo,
  FolderKanban,
  Share2,
  Copy,
  Check,
  ExternalLink,
  Pencil,
  Plus,
} from 'lucide-react';
import { CalendarEventItem, ProjectItem } from '../types';
import {
  detectBrowserTimeZone,
  GLOBAL_EVENT_TIMEZONES,
  isValidTimeZone,
  projectEventToViewerTimeZone,
  TimeZoneOption,
} from '../shared/timeZoneUtils';
import {
  buildLocationSearchQuery,
  formatCombinedLocation,
} from '../shared/locationUtils';
import { resolveEventLuxuryTheme } from '../utils/eventTheme';
import { buildGoogleMapsSearchUrl } from '../utils/shareCodec';
import { generateIcsContent, downloadIcsFile } from '../utils/icsExport';

interface EventDetailContentProps {
  event: CalendarEventItem;
  viewerTimeZone?: string;
  hasConflict?: boolean;
  projects?: ProjectItem[];
  variant?: 'modal' | 'panel';
  onUpdateProject?: (eventId: string, projectId: string | undefined) => void;
  onUpdateTimeZone?: (eventId: string, timeZone: string | undefined) => void;
  onUpdateLocation?: (
    eventId: string,
    location?: string,
    locationAddress?: string
  ) => void;
  onToggleComplete: (id: string) => void;
  onToggleChecklistItem: (eventId: string, itemId: string) => void;
  onShare?: (event: CalendarEventItem) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export const EventDetailContent: React.FC<EventDetailContentProps> = ({
  event,
  viewerTimeZone,
  hasConflict = false,
  projects = [],
  variant = 'modal',
  onUpdateProject,
  onUpdateTimeZone,
  onUpdateLocation,
  onToggleComplete,
  onToggleChecklistItem,
  onShare,
  onDelete,
  onClose,
}) => {
  const theme = resolveEventLuxuryTheme(event, projects);
  const currentProject = theme.project;
  const isPanel = variant === 'panel';

  const [isEditingLocation, setIsEditingLocation] = useState(false);
  const [locDraft, setLocDraft] = useState(event.location || '');
  const [addrDraft, setAddrDraft] = useState(event.locationAddress || '');
  const [copiedAddress, setCopiedAddress] = useState(false);

  useEffect(() => {
    setIsEditingLocation(false);
    setLocDraft(event.location || '');
    setAddrDraft(event.locationAddress || '');
    setCopiedAddress(false);
  }, [event.id, event.location, event.locationAddress]);

  const safeViewerZone = useMemo(
    () =>
      viewerTimeZone && isValidTimeZone(viewerTimeZone)
        ? viewerTimeZone
        : detectBrowserTimeZone(),
    [viewerTimeZone]
  );

  const timing = useMemo(
    () => projectEventToViewerTimeZone(event, safeViewerZone),
    [event, safeViewerZone]
  );

  const timeZoneOptions = useMemo(() => {
    const map = new Map<string, TimeZoneOption>();
    if (!GLOBAL_EVENT_TIMEZONES.some((tz) => tz.iana === timing.viewerMeta.iana)) {
      map.set(timing.viewerMeta.iana, timing.viewerMeta);
    }
    if (!GLOBAL_EVENT_TIMEZONES.some((tz) => tz.iana === timing.sourceMeta.iana)) {
      map.set(timing.sourceMeta.iana, timing.sourceMeta);
    }
    for (const tz of GLOBAL_EVENT_TIMEZONES) {
      map.set(tz.iana, tz);
    }
    return Array.from(map.values());
  }, [timing.viewerMeta, timing.sourceMeta]);

  const handleDownloadSingleIcs = () => {
    const ics = generateIcsContent([event], event.title);
    downloadIcsFile(`${event.title}.ics`, ics);
  };

  const handleCopyLocationText = async () => {
    const textToCopy = formatCombinedLocation(
      event.location,
      event.locationAddress,
      ' — '
    );
    if (!textToCopy) return;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopiedAddress(true);
      window.setTimeout(() => setCopiedAddress(false), 1600);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleSaveLocation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!onUpdateLocation) return;
    onUpdateLocation(event.id, locDraft, addrDraft);
    setIsEditingLocation(false);
  };

  const mapsQuery = buildLocationSearchQuery(event.location, event.locationAddress);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* 상단 액션 헤더 (Smoked Obsidian + Zero-Pill 무박스 메타데이터) */}
      <div
        className={
          isPanel
            ? 'h-11 px-3.5 border-b border-white/[0.07] flex items-center justify-between gap-2 shrink-0 bg-[#12151e]'
            : 'px-5 py-3.5 border-b border-white/[0.07] flex items-center justify-between gap-3 shrink-0 bg-[#13161f]'
        }
      >
        <div className="flex items-center gap-1.5 text-xs text-neutral-400 min-w-0 truncate">
          <span className={`w-[6px] h-[6px] rounded-full shrink-0 ${theme.dotClass}`} />
          {currentProject && (
            <>
              <span
                className={`font-medium truncate max-w-[140px] ${theme.accentTextClass}`}
                title={currentProject.name}
              >
                {currentProject.code || currentProject.name}
              </span>
              <span aria-hidden="true" className="text-neutral-600 shrink-0">
                ·
              </span>
            </>
          )}
          <span className="text-neutral-300 shrink-0">{event.category}</span>

          {hasConflict && (
            <>
              <span aria-hidden="true" className="text-neutral-600 shrink-0">
                ·
              </span>
              <span className="inline-flex items-center gap-1 text-amber-300 shrink-0">
                <AlertTriangle className="w-3 h-3 shrink-0" />
                <span>시간 겹침</span>
              </span>
            </>
          )}

          {event.isCompleted && (
            <>
              <span aria-hidden="true" className="text-neutral-600 shrink-0">
                ·
              </span>
              <span className="inline-flex items-center gap-1 text-emerald-300 shrink-0">
                <CheckCircle className="w-3 h-3 shrink-0" />
                <span>완료됨</span>
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          {onShare && (
            <button
              type="button"
              onClick={() => onShare(event)}
              className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
              title="브리핑 패스 공유"
            >
              <Share2 className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={handleDownloadSingleIcs}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
            title="ICS 파일 다운로드"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(event.id)}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
            title="일정 삭제"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
            title="닫기"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 본문 스크롤 영역 */}
      <div className="flex-1 p-5 overflow-y-auto space-y-5 select-text">
        {/* 제목 & 완료 토글 + 인라인 시간대 지정 */}
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => onToggleComplete(event.id)}
            className="mt-1 text-neutral-400 hover:text-emerald-400 transition-colors cursor-pointer shrink-0"
            title={event.isCompleted ? '완료 취소' : '일정 완료'}
          >
            {event.isCompleted ? (
              <CheckCircle className="w-5 h-5 text-emerald-400" />
            ) : (
              <Circle className="w-5 h-5" />
            )}
          </button>
          <div className="flex-1 min-w-0">
            <h3
              className={`text-base sm:text-lg font-bold leading-snug break-words ${
                event.isCompleted ? 'line-through text-neutral-500' : 'text-neutral-100'
              }`}
            >
              {event.title}
            </h3>

            <div className="text-xs text-neutral-400 mt-1.5 flex items-center gap-1.5 flex-wrap font-mono tabular-nums">
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <Calendar className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                <span className="text-neutral-200">{event.date}</span>
              </span>
              <span className="text-neutral-600" aria-hidden="true">
                ·
              </span>
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <Clock className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                <span className="text-neutral-200">
                  {event.isAllDay ? '종일 일정' : `${event.startTime} – ${event.endTime}`}
                </span>
              </span>

              {!event.isAllDay &&
                (onUpdateTimeZone ? (
                  <select
                    value={timing.sourceTimeZone}
                    onChange={(e) => onUpdateTimeZone(event.id, e.target.value)}
                    aria-label="일정 기준 시간대"
                    title="일정 시간의 기준 시간대 선택"
                    className="ml-0.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-white/[0.18] rounded-md px-1.5 py-0.5 text-[11px] font-mono text-neutral-200 outline-hidden cursor-pointer transition-colors whitespace-nowrap shrink-0"
                  >
                    {timeZoneOptions.map((tz) => (
                      <option
                        key={tz.iana}
                        value={tz.iana}
                        className="bg-[#12151e] text-neutral-100"
                      >
                        {tz.shortCode} · {tz.cityKo}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-[11px] text-neutral-400 whitespace-nowrap">
                    {timing.sourceMeta.shortCode}
                  </span>
                ))}
            </div>

            {!event.isAllDay && timing.hasOffsetDiff && (
              <p className="mt-1 text-[11px] font-mono tabular-nums text-neutral-400">
                내 위치({timing.viewerMeta.cityKo}) 기준{' '}
                {timing.localDate !== event.date ? `${timing.localDate} ` : ''}
                <span className="text-neutral-200">
                  {timing.localStartTime} – {timing.localEndTime}
                </span>{' '}
                <span className="text-neutral-500">{timing.viewerMeta.shortCode}</span>
              </p>
            )}
          </div>
        </div>

        {/* 소속 프로젝트 */}
        <div className="flex items-center justify-between p-3 rounded-xl bg-[#161a24] border border-white/[0.06] text-xs gap-2">
          <div className="flex items-center gap-2 shrink-0">
            <FolderKanban className="w-4 h-4 text-neutral-400" />
            <span className="font-medium text-neutral-300">소속 프로젝트</span>
          </div>
          {onUpdateProject ? (
            <select
              value={event.projectId || ''}
              onChange={(e) => onUpdateProject(event.id, e.target.value || undefined)}
              className="bg-[#10131b] border border-white/[0.09] rounded-lg px-2.5 py-1 text-xs text-neutral-100 outline-hidden cursor-pointer hover:border-white/20 transition-colors max-w-[210px] truncate"
            >
              <option value="">(지정 안 됨 / 일반 일정)</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-neutral-400">
              {currentProject ? (
                <span className="flex items-center gap-1.5 font-medium text-neutral-100">
                  <span className={`w-2 h-2 rounded-full ${theme.dotClass}`} />
                  {currentProject.name}
                </span>
              ) : (
                '지정 안 됨'
              )}
            </span>
          )}
        </div>

        {/* 공식 장소명 · 상세 주소 2단 섹션 및 인라인 편집 */}
        {isEditingLocation ? (
          <form
            onSubmit={handleSaveLocation}
            className="p-3.5 rounded-xl bg-[#161a24] border border-white/[0.12] space-y-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-neutral-200 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                <span>정확한 장소명 및 상세 주소 편집</span>
              </span>
            </div>

            <div className="space-y-2">
              <div>
                <label className="block text-[11px] text-neutral-400 mb-1">
                  공식 장소명 · 건물 · 층 · 호실
                </label>
                <input
                  type="text"
                  value={locDraft}
                  onChange={(e) => setLocDraft(e.target.value)}
                  placeholder="예: 아스트라 타워 서관 3층 대회의실"
                  autoFocus
                  className="w-full h-9 px-3 rounded-lg bg-[#0e1118] border border-white/[0.09] focus:border-white/25 text-xs text-neutral-100 placeholder:text-neutral-600 outline-hidden"
                />
              </div>

              <div>
                <label className="block text-[11px] text-neutral-400 mb-1">
                  상세 도로명 · 지번 주소
                </label>
                <input
                  type="text"
                  value={addrDraft}
                  onChange={(e) => setAddrDraft(e.target.value)}
                  placeholder="예: 서울특별시 중구 노바센트럴로 88"
                  className="w-full h-9 px-3 rounded-lg bg-[#0e1118] border border-white/[0.09] focus:border-white/25 text-xs text-neutral-100 placeholder:text-neutral-600 outline-hidden"
                />
              </div>
            </div>

            <p className="text-[10.5px] text-neutral-500 leading-snug">
              모호한 수식어(&apos;~인근&apos;, &apos;~근처&apos;)는 저장 시 자동으로 정제되며 공식 명칭과 주소만 유지됩니다.
            </p>

            <div className="flex items-center justify-end gap-1.5 pt-0.5">
              <button
                type="button"
                onClick={() => {
                  setLocDraft(event.location || '');
                  setAddrDraft(event.locationAddress || '');
                  setIsEditingLocation(false);
                }}
                className="h-8 px-3 rounded-lg border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] text-xs text-neutral-300 transition-colors cursor-pointer whitespace-nowrap"
              >
                취소
              </button>
              <button
                type="submit"
                className="h-8 px-3.5 rounded-lg bg-white text-neutral-950 hover:bg-neutral-200 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
              >
                저장
              </button>
            </div>
          </form>
        ) : event.location || event.locationAddress ? (
          <div className="p-3.5 rounded-xl bg-[#161a24] border border-white/[0.06] space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-neutral-400 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                <span>장소 및 상세 주소</span>
              </span>

              <div className="flex items-center gap-1 shrink-0 select-none">
                <button
                  type="button"
                  onClick={handleCopyLocationText}
                  className="h-6 px-2 rounded-md bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.07] text-[10.5px] text-neutral-300 hover:text-white inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap"
                  title="장소명 및 상세 주소 복사"
                >
                  {copiedAddress ? (
                    <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                  ) : (
                    <Copy className="w-3 h-3 shrink-0" />
                  )}
                  <span>{copiedAddress ? '복사됨' : '주소 복사'}</span>
                </button>

                {mapsQuery && (
                  <a
                    href={buildGoogleMapsSearchUrl(mapsQuery)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="h-6 px-2 rounded-md bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.07] text-[10.5px] text-neutral-300 hover:text-white inline-flex items-center gap-1 transition-colors whitespace-nowrap"
                    title="Google 지도에서 위치 확인"
                  >
                    <span>지도</span>
                    <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                  </a>
                )}

                {onUpdateLocation && (
                  <button
                    type="button"
                    onClick={() => setIsEditingLocation(true)}
                    className="h-6 px-2 rounded-md bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.07] text-[10.5px] text-neutral-300 hover:text-white inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap"
                    title="장소 및 주소 편집"
                  >
                    <Pencil className="w-2.5 h-2.5 shrink-0" />
                    <span>편집</span>
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-0.5 pl-5">
              {event.location && (
                <p className="text-xs sm:text-sm font-medium text-neutral-100 break-words leading-snug">
                  {event.location}
                </p>
              )}
              {event.locationAddress && (
                <p className="text-xs text-neutral-400 break-words leading-relaxed">
                  {event.locationAddress}
                </p>
              )}
            </div>
          </div>
        ) : onUpdateLocation ? (
          <button
            type="button"
            onClick={() => setIsEditingLocation(true)}
            className="w-full p-3 rounded-xl border border-dashed border-white/[0.09] hover:border-white/[0.18] bg-white/[0.015] hover:bg-white/[0.03] text-xs text-neutral-400 hover:text-neutral-200 flex items-center justify-center gap-1.5 transition-colors cursor-pointer select-none"
          >
            <Plus className="w-3.5 h-3.5 shrink-0" />
            <span>정확한 장소명 · 상세 도로명 주소 입력</span>
          </button>
        ) : null}

        {/* 상세 설명 */}
        {event.content && (
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-neutral-400 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-neutral-400" />
              <span>상세 메모 및 파트너 정보</span>
            </span>
            <div className="p-3.5 rounded-xl bg-[#161a24] border border-white/[0.06] text-xs sm:text-sm text-neutral-300 whitespace-pre-wrap leading-relaxed">
              {event.content}
            </div>
          </div>
        )}

        {/* 체크리스트 */}
        {event.checklist && event.checklist.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-neutral-400 flex items-center gap-1.5">
                <ListTodo className="w-3.5 h-3.5 text-neutral-400" />
                <span>체크리스트</span>
              </span>
              <span className="text-xs font-mono text-neutral-400 tabular-nums">
                {event.checklist.filter((c) => c.done).length} / {event.checklist.length}
              </span>
            </div>
            <div className="space-y-1.5 bg-[#161a24] p-3 rounded-xl border border-white/[0.06]">
              {event.checklist.map((item) => (
                <div
                  key={item.id}
                  onClick={() => onToggleChecklistItem(event.id, item.id)}
                  className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-white/[0.04] transition-colors cursor-pointer group select-none"
                >
                  {item.done ? (
                    <CheckSquare className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <Square className="w-4 h-4 text-neutral-500 group-hover:text-neutral-300 shrink-0" />
                  )}
                  <span
                    className={`text-xs ${
                      item.done ? 'line-through text-neutral-500' : 'text-neutral-200'
                    }`}
                  >
                    {item.text}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
