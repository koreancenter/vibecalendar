import React, { useState } from 'react';
import {
  Sparkles,
  Store,
  MapPin,
  Users,
  Plus,
  Calendar,
  Clock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  BrainCircuit,
  Check,
  AlertTriangle,
  ArrowRight,
  Globe,
  ExternalLink,
} from 'lucide-react';
import {
  AgentCommandResponse,
  GroundedDateSuggestion,
  RecommendedVenue,
} from '../../types';
import {
  detectBrowserTimeZone,
  getTimeZoneMeta,
  isValidTimeZone,
  projectEventToViewerTimeZone,
} from '../../shared/timeZoneUtils';
import { formatCombinedLocation } from '../../shared/locationUtils';

interface AgentResponseCardsProps {
  response: AgentCommandResponse;
  selectedDate: string;
  viewerTimeZone?: string;
  addedVenueIds: Set<string>;
  addedGroundedIds?: Set<string>;
  onAddVenueToCalendar: (venue: RecommendedVenue) => void;
  onAddGroundedSuggestion?: (item: GroundedDateSuggestion) => void;
  onJumpToDate?: (date: string) => void;
  onSendMessage: (prompt: string) => void;
  onUpdateTimeSlot?: (eventId: string, startTime: string, endTime: string) => void;
}

export const AgentResponseCards: React.FC<AgentResponseCardsProps> = ({
  response: resp,
  selectedDate,
  viewerTimeZone,
  addedVenueIds,
  addedGroundedIds = new Set(),
  onAddVenueToCalendar,
  onAddGroundedSuggestion,
  onJumpToDate,
  onSendMessage,
  onUpdateTimeSlot,
}) => {
  const [isTraceExpanded, setIsTraceExpanded] = useState(false);
  const safeViewerZone =
    viewerTimeZone && isValidTimeZone(viewerTimeZone)
      ? viewerTimeZone
      : detectBrowserTimeZone();

  return (
    <div className="w-full space-y-2 mt-1">
      {/* 1. 일정 조회 브리핑 카드 (QUERY_EVENTS) */}
      {(resp.actionType === 'QUERY_EVENTS' || (resp.queriedEvents && resp.queriedEvents.length > 0)) && (
        <div className="bg-[#181b24] border border-indigo-500/25 rounded-xl p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-300">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              <span>스케줄 브리핑</span>
            </div>
            <span className="text-[10px] text-neutral-400 font-mono tabular-nums">
              {resp.targetDate || selectedDate} · {resp.queriedEvents?.length || 0}건
            </span>
          </div>

          {resp.queriedEvents && resp.queriedEvents.length > 0 ? (
            <div className="space-y-1.5">
              {resp.queriedEvents.map((ev) => {
                const timing = projectEventToViewerTimeZone(ev, safeViewerZone);
                return (
                  <div
                    key={ev.id}
                    className="bg-[#202430] p-2.5 rounded-lg border border-white/[0.06] hover:border-indigo-500/30 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-white truncate">{ev.title}</span>
                      <span className="text-[10px] text-neutral-400 shrink-0">
                        {ev.category}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-neutral-400 mt-1">
                      <span className="flex items-center gap-1 text-indigo-300 font-mono tabular-nums shrink-0">
                        <Clock className="w-3 h-3 text-indigo-400" />
                        {ev.isAllDay ? '종일' : timing.rangeLabel}
                      </span>
                    </div>
                    {(ev.location || ev.locationAddress) && (
                      <div className="mt-1.5 flex items-start gap-1 text-[10px] text-neutral-400 min-w-0">
                        <MapPin className="w-3 h-3 text-neutral-500 shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          {ev.location && (
                            <div className="text-neutral-300 truncate">{ev.location}</div>
                          )}
                          {ev.locationAddress && (
                            <div className="text-[10px] text-neutral-500 truncate">
                              {ev.locationAddress}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-3 bg-[#202430]/60 rounded-lg text-center text-xs text-neutral-400 space-y-0.5">
              <p className="text-neutral-300 font-medium">등록된 일정이 없습니다.</p>
              <p className="text-[10px] text-neutral-500">여유 시간대에 새로운 일정을 등록해 보세요.</p>
            </div>
          )}

          {resp.freeTimeSlots && resp.freeTimeSlots.length > 0 && (
            <div className="pt-2 border-t border-white/[0.06] space-y-1.5">
              <div className="text-[10px] font-medium text-emerald-400 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                <span>여유 시간대 (클릭 시 일정 등록):</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {resp.freeTimeSlots.map((slot, sIdx) => (
                  <button
                    key={`${slot.startTime}-${sIdx}`}
                    type="button"
                    onClick={() =>
                      onSendMessage(
                        `${resp.targetDate || selectedDate} ${slot.startTime || '14:00'} 회의 등록해줘`
                      )
                    }
                    className="px-2 py-1 rounded-md bg-emerald-950/40 border border-emerald-500/25 hover:border-emerald-400 text-[10px] text-emerald-200 transition-colors flex items-center gap-1 cursor-pointer tabular-nums"
                  >
                    <span className="font-mono font-semibold">
                      {slot.startTime} – {slot.endTime}
                    </span>
                    {slot.label && <span className="text-neutral-400 text-[9px]">({slot.label})</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 2. 일정 수정 반영 카드 (UPDATE_EVENT) */}
      {(resp.actionType === 'UPDATE_EVENT' || resp.updatedEvent) && resp.updatedEvent && (
        <div className="bg-[#181b24] border border-amber-500/25 rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-300">
              <CheckCircle2 className="w-3.5 h-3.5 text-amber-400" />
              <span>
                {!Object.keys(resp.updatedEvent.updates || {}).length
                  ? '일정 문맥 식별'
                  : '일정 수정 반영 완료'}
              </span>
            </div>
            <span className="text-[10px] text-amber-300/80 font-mono">수정됨</span>
          </div>
          <div className="bg-[#202430] p-2.5 rounded-lg border border-white/[0.06] space-y-1">
            <div className="text-xs font-semibold text-white">
              {resp.updatedEvent.targetTitle || '일정'}
            </div>
            {(resp.updatedEvent.updates?.startTime || resp.updatedEvent.updates?.timeZone) && (
              <div className="flex items-center gap-2 text-[11px] text-amber-300 font-mono tabular-nums">
                <Clock className="w-3 h-3 text-amber-400" />
                <span>
                  {resp.updatedEvent.updates.startTime
                    ? `${resp.updatedEvent.updates.startTime} – ${resp.updatedEvent.updates.endTime || ''}`
                    : '시간대 변경'}
                  {resp.updatedEvent.updates.timeZone
                    ? ` ${getTimeZoneMeta(resp.updatedEvent.updates.timeZone).shortCode}`
                    : ''}
                </span>
              </div>
            )}
            {(resp.updatedEvent.updates?.location || resp.updatedEvent.updates?.locationAddress) && (
              <div className="flex items-start gap-1.5 text-[10px] text-neutral-300">
                <MapPin className="w-3 h-3 text-neutral-400 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  {resp.updatedEvent.updates.location && (
                    <div className="text-neutral-200 break-words">
                      {resp.updatedEvent.updates.location}
                    </div>
                  )}
                  {resp.updatedEvent.updates.locationAddress && (
                    <div className="text-neutral-400 break-words">
                      {resp.updatedEvent.updates.locationAddress}
                    </div>
                  )}
                </div>
              </div>
            )}
            {resp.updatedEvent.diffSummary && (
              <div className="text-[10px] text-neutral-400 pt-1 border-t border-white/[0.04]">
                {resp.updatedEvent.diffSummary}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 3. 일정 삭제 완료 카드 (DELETE_EVENT) */}
      {(resp.actionType === 'DELETE_EVENT' || Boolean(resp.deletedEventId)) && (
        <div className="bg-[#181b24] border border-rose-500/25 rounded-xl p-3 space-y-1.5">
          <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-300">
              <CheckCircle2 className="w-3.5 h-3.5 text-rose-400" />
              <span>캘린더 일정 삭제 완료</span>
            </div>
            <span className="text-[10px] text-rose-300/80 font-mono">삭제됨</span>
          </div>
          <p className="text-[11px] text-neutral-300 bg-[#202430] p-2 rounded-lg border border-white/[0.06]">
            {resp.replyText || '선택한 일정이 캘린더에서 제거되었습니다.'}
          </p>
        </div>
      )}

      {/* 4. 장소 추천 카드 (RECOMMEND_VENUE) */}
      {resp.recommendedVenues && resp.recommendedVenues.length > 0 && (
        <div className="bg-[#181b24] border border-white/[0.08] rounded-xl p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-200 flex items-center gap-1.5">
              <Store className="w-3.5 h-3.5 text-amber-400" />
              추천 장소 · {resp.recommendedVenues.length}곳
            </span>
            <span className="text-[10px] text-neutral-400 font-mono tabular-nums">
              {resp.targetDate || selectedDate}
            </span>
          </div>

          <div className="space-y-2.5">
            {resp.recommendedVenues.map((venue) => {
              const isAdded = addedVenueIds.has(venue.id);

              return (
                <div
                  key={venue.id}
                  className="bg-[#202430] border border-white/[0.06] rounded-xl p-3 flex flex-col gap-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="text-xs font-semibold text-white leading-tight">{venue.name}</h4>
                    <span className="text-[10px] text-amber-300/90 shrink-0">
                      {venue.category}
                    </span>
                  </div>

                  <div className="space-y-1 text-[11px] text-neutral-300">
                    <div className="flex items-center gap-1 text-neutral-400">
                      <MapPin className="w-3 h-3 text-neutral-500 shrink-0" />
                      <span className="truncate">{venue.address}</span>
                    </div>
                    <div className="flex items-center gap-1 text-emerald-400 font-medium">
                      <Users className="w-3 h-3 shrink-0" />
                      <span>{venue.capacityInfo}</span>
                    </div>
                    {venue.priceRange && (
                      <div className="text-[10px] text-neutral-400">가격대: {venue.priceRange}</div>
                    )}
                  </div>

                  <p className="text-[11px] text-neutral-300 bg-black/20 p-2 rounded-lg leading-relaxed">
                    {venue.reason}
                  </p>

                  <button
                    type="button"
                    onClick={() => onAddVenueToCalendar(venue)}
                    disabled={isAdded}
                    className={`w-full py-1.5 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      isAdded
                        ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 cursor-default'
                        : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                    }`}
                  >
                    {isAdded ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>캘린더 등록 완료</span>
                      </>
                    ) : (
                      <>
                        <Plus className="w-3.5 h-3.5" />
                        <span>
                          {venue.targetDate || resp.targetDate || selectedDate} 캘린더에 등록
                        </span>
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 4-2. Google Search 그라운딩 기반 공휴일 · 업계 행사 · 추천 후보일 카드 */}
      {((resp.groundedSuggestions && resp.groundedSuggestions.length > 0) ||
        (resp.groundingSources && resp.groundingSources.length > 0)) && (
        <div className="bg-[#161922] border border-white/[0.08] rounded-xl p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-200">
              <Globe className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
              <span>공휴일 · 업계 일정 탐색</span>
            </div>
            {resp.groundedSuggestions && resp.groundedSuggestions.length > 0 && (
              <span className="text-[10px] font-mono tabular-nums text-neutral-500">
                {resp.groundedSuggestions.length}건
              </span>
            )}
          </div>

          {resp.groundedSuggestions && resp.groundedSuggestions.length > 0 && (
            <div className="space-y-1.5">
              {resp.groundedSuggestions.map((item) => {
                const isAdded = addedGroundedIds.has(item.id);
                const kindLabel =
                  item.kind === 'holiday'
                    ? '공휴일'
                    : item.kind === 'recommended_date'
                    ? '추천 후보일'
                    : '업계 행사';

                return (
                  <div
                    key={item.id}
                    className={`rounded-lg p-2.5 border transition-colors space-y-1 ${
                      item.kind === 'recommended_date'
                        ? 'bg-white/[0.045] border-white/[0.12]'
                        : 'bg-[#1c202c]/80 border-white/[0.05]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-[10px] text-neutral-400 min-w-0">
                        <button
                          type="button"
                          onClick={() => onJumpToDate?.(item.date)}
                          className="font-mono tabular-nums text-neutral-100 hover:text-white hover:underline cursor-pointer shrink-0"
                          title="해당 날짜로 달력 이동"
                        >
                          {item.endDate
                            ? `${item.date} – ${item.endDate.slice(5)}`
                            : item.date}
                        </button>
                        <span aria-hidden="true" className="text-neutral-600">
                          ·
                        </span>
                        <span className="shrink-0">{kindLabel}</span>
                        {item.advisory && (
                          <>
                            <span aria-hidden="true" className="text-neutral-600">
                              ·
                            </span>
                            <span
                              className={`truncate ${
                                item.kind === 'recommended_date'
                                  ? 'text-white font-medium'
                                  : 'text-neutral-300'
                              }`}
                            >
                              {item.advisory}
                            </span>
                          </>
                        )}
                      </div>

                      {onAddGroundedSuggestion && (
                        <button
                          type="button"
                          disabled={isAdded}
                          onClick={() => onAddGroundedSuggestion(item)}
                          className={`h-6 px-2 rounded-md text-[10px] font-medium flex items-center gap-1 transition-colors shrink-0 whitespace-nowrap ${
                            isAdded
                              ? 'text-neutral-400 bg-white/[0.03] cursor-default'
                              : item.kind === 'recommended_date'
                              ? 'bg-white text-neutral-950 hover:bg-neutral-200 cursor-pointer'
                              : 'bg-white/[0.07] hover:bg-white/[0.13] text-neutral-200 cursor-pointer'
                          }`}
                        >
                          {isAdded ? (
                            <>
                              <Check className="w-3 h-3" />
                              <span>반영됨</span>
                            </>
                          ) : (
                            <>
                              <Plus className="w-3 h-3" />
                              <span>
                                {item.kind === 'recommended_date' ? '이 날짜로 등록' : '캘린더 표시'}
                              </span>
                            </>
                          )}
                        </button>
                      )}
                    </div>

                    <div className="text-xs font-medium text-white leading-snug">
                      {item.title}
                    </div>

                    <p className="text-[11px] text-neutral-400 leading-relaxed">
                      {item.description}
                    </p>
                    {(item.location || item.locationAddress) && (
                      <div className="flex items-start gap-1 text-[10px] text-neutral-400 pt-0.5">
                        <MapPin className="w-3 h-3 text-neutral-500 shrink-0 mt-0.5" />
                        <span className="break-words">
                          {formatCombinedLocation(item.location, item.locationAddress)}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {resp.groundingSources && resp.groundingSources.length > 0 && (
            <div className="pt-2 space-y-1">
              <div className="h-px bg-gradient-to-r from-white/[0.12] via-white/[0.06] to-white/[0.01] mb-2" />
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px]">
                <span className="text-neutral-500 shrink-0">검색 출처</span>
                {resp.groundingSources.map((src) => (
                  <a
                    key={src.uri}
                    href={src.uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-neutral-400 hover:text-white transition-colors max-w-[175px]"
                    title={src.title}
                  >
                    <span className="truncate">{src.title}</span>
                    <ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-70" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 5. 신규 등록 일정 카드 (CREATE_EVENT) */}
      {resp.createdEvents && resp.createdEvents.length > 0 && (
        <div className="bg-[#181b24] border border-emerald-500/25 rounded-xl p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>캘린더에 등록된 일정</span>
          </div>
          {resp.createdEvents.map((ev) => {
            const timing = projectEventToViewerTimeZone(ev, safeViewerZone);
            const createdTimeLabel = ev.isAllDay
              ? '종일'
              : timing.isSameZone
              ? `${ev.startTime} – ${ev.endTime}`
              : timing.hasOffsetDiff
              ? `${ev.startTime} – ${ev.endTime} ${timing.sourceMeta.shortCode} · 현지 ${timing.localStartTime} – ${timing.localEndTime}`
              : `${ev.startTime} – ${ev.endTime} ${timing.sourceMeta.shortCode}`;

            return (
              <div key={ev.id} className="bg-[#202430] p-2.5 rounded-lg border border-white/[0.06]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-white truncate">{ev.title}</span>
                  <span className="text-[10px] text-neutral-400 shrink-0">
                    {ev.category}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-neutral-400 mt-1 font-mono tabular-nums flex-wrap">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {ev.endDate && ev.endDate > ev.date
                      ? `${ev.date} – ${ev.endDate.slice(5)}`
                      : ev.date}
                  </span>
                  <span className="flex items-center gap-1 text-neutral-300">
                    <Clock className="w-3 h-3" />
                    {createdTimeLabel}
                  </span>
                </div>
                {(ev.location || ev.locationAddress) && (
                  <div className="flex items-start gap-1 text-[10px] text-neutral-400 mt-1.5 min-w-0">
                    <MapPin className="w-3 h-3 text-neutral-500 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      {ev.location && (
                        <div className="text-neutral-200 truncate">{ev.location}</div>
                      )}
                      {ev.locationAddress && (
                        <div className="text-neutral-500 truncate">{ev.locationAddress}</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 6. 일정 시간 충돌 경고 및 대체 시간 제안 */}
      {resp.conflictWarning && resp.conflictWarning.hasConflict && (
        <div className="bg-amber-950/35 border border-amber-500/35 rounded-xl p-3 space-y-2.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-300">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
            <span>일정 시간 충돌 감지</span>
          </div>

          <p className="text-[11px] text-amber-200/90 leading-relaxed">
            {resp.conflictWarning.message}
          </p>

          {resp.conflictWarning.suggestedSlots && resp.conflictWarning.suggestedSlots.length > 0 && (
            <div className="space-y-1.5 pt-1.5 border-t border-amber-500/20">
              <span className="text-[10px] font-medium text-neutral-300 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-amber-400" />
                <span>
                  {resp.conflictWarning.targetEventTitle &&
                  (resp.createdEvents?.length || 0) > 1
                    ? `'${resp.conflictWarning.targetEventTitle}' 여유 시간대로 즉시 변경:`
                    : '여유 시간대로 즉시 변경:'}
                </span>
              </span>

              <div className="grid grid-cols-1 gap-1.5">
                {resp.conflictWarning.suggestedSlots.map((slot, sIdx) => {
                  const targetEvtId =
                    resp.conflictWarning?.targetEventId || resp.createdEvents?.[0]?.id;
                  return (
                    <button
                      key={`${slot.startTime}-${sIdx}`}
                      type="button"
                      onClick={() => {
                        if (targetEvtId && onUpdateTimeSlot) {
                          onUpdateTimeSlot(targetEvtId, slot.startTime, slot.endTime);
                        }
                      }}
                      className="w-full text-left px-2.5 py-1.5 rounded-lg bg-amber-900/25 hover:bg-amber-800/40 border border-amber-500/30 hover:border-amber-400 text-xs flex items-center justify-between transition-all cursor-pointer group"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-semibold text-amber-200 tabular-nums">
                          {slot.startTime} – {slot.endTime}
                        </span>
                        {slot.label && (
                          <span className="text-[10px] text-neutral-400">({slot.label})</span>
                        )}
                      </div>
                      <span className="text-[10px] text-amber-300 group-hover:text-white flex items-center gap-0.5 font-medium">
                        적용 <ArrowRight className="w-3 h-3" />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 7. AI 추론 근거 */}
      {resp.thoughtTrace && (
        <div className="border border-white/[0.06] rounded-xl overflow-hidden">
          <button
            type="button"
            onClick={() => setIsTraceExpanded((prev) => !prev)}
            className="w-full px-3 py-1.5 bg-[#161821] hover:bg-[#1a1d28] text-[11px] text-neutral-400 hover:text-neutral-200 flex items-center justify-between transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-1">
              <BrainCircuit className="w-3 h-3 text-indigo-400" />
              AI 분석 근거
            </span>
            {isTraceExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>

          {isTraceExpanded && (
            <div className="p-3 bg-[#11131a] text-[11px] text-neutral-400 space-y-1">
              <p className="font-medium text-neutral-300">{resp.thoughtTrace.summary}</p>
              {resp.thoughtTrace.intent && <p>• 의도: {resp.thoughtTrace.intent}</p>}
              {resp.thoughtTrace.steps && resp.thoughtTrace.steps.length > 0 && (
                <div className="space-y-1 mt-1 pt-1 border-t border-white/[0.06]">
                  {resp.thoughtTrace.steps.map((st, idx) => (
                    <div key={`${st.step}-${idx}`} className="flex items-center gap-1.5 text-[10px]">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
                      <span className="text-neutral-300 shrink-0">{st.title}:</span>
                      <span className="text-neutral-400 truncate">{st.details}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 8. 후속 제안 프롬프트 */}
      {resp.suggestedPrompts && resp.suggestedPrompts.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {resp.suggestedPrompts.map((sug, sIdx) => (
            <button
              key={`${sug}-${sIdx}`}
              type="button"
              onClick={() => onSendMessage(sug)}
              className="px-2.5 py-1 rounded-lg bg-[#1a1d27] border border-white/[0.08] hover:border-indigo-500/40 text-[11px] text-neutral-300 hover:text-white transition-colors cursor-pointer flex items-center gap-1"
            >
              <Sparkles className="w-2.5 h-2.5 text-indigo-400 shrink-0" />
              <span>{sug}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
