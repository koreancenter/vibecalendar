import {
  AgentActionType,
  AgentCommandResponse,
  CalendarCategory,
  CalendarEventItem,
  RecommendedVenue,
} from '../types';
import { AgentAttachmentPayload, AgentContext } from './agentApi';
import { parseNaturalDateFromText } from '../shared/dateUtils';
import { normalizePlaceAndAddress } from '../shared/locationUtils';
import { calculateFreeTimeSlots } from '../shared/scheduleUtils';
import {
  detectBrowserTimeZone,
  inferTimeZoneFromLocation,
  isValidTimeZone,
  mapEventsToViewerZone,
  parseExplicitTimeZoneFromText,
  projectEventToViewerTimeZone,
} from '../shared/timeZoneUtils';

const VALID_ACTIONS = new Set<AgentActionType>([
  'QUERY_EVENTS',
  'CREATE_EVENT',
  'RECOMMEND_VENUE',
  'UPDATE_EVENT',
  'DELETE_EVENT',
  'GENERAL_CHAT',
]);

const VALID_CATEGORIES = new Set<CalendarCategory>([
  '업무',
  '방문·출장',
  '식사·모임',
  '개인',
  '행사·세미나',
  '기타',
]);

export const COMPACT_LOCAL_SYSTEM_PROMPT = `당신은 한국어 일정 관리 컨시어지입니다. 반드시 순수 JSON 객체 하나만 출력하세요. 마크다운 코드블록 없이 JSON만 반환하세요.

출력 JSON 스키마:
{
  "actionType": "QUERY_EVENTS" | "CREATE_EVENT" | "UPDATE_EVENT" | "DELETE_EVENT" | "RECOMMEND_VENUE" | "GENERAL_CHAT",
  "targetDate": "YYYY-MM-DD",
  "replyText": "한국어 안내 메시지",
  "createdEvents": [
    {
      "title": "일정 제목",
      "date": "YYYY-MM-DD",
      "startTime": "HH:mm",
      "endTime": "HH:mm",
      "timeZone": "Asia/Seoul",
      "isAllDay": false,
      "category": "업무" | "방문·출장" | "식사·모임" | "개인" | "행사·세미나" | "기타",
      "location": "정확한 공식 장소·건물·호실명 (~인근 표현 금지)",
      "locationAddress": "시/도 시/군/구 도로명 건물번호 상세 주소",
      "content": "상세 메모"
    }
  ],
  "updatedEvent": {
    "id": "대상 일정 id",
    "targetTitle": "대상 일정 제목",
    "diffSummary": "변경 요약",
    "updates": { "date": "YYYY-MM-DD", "startTime": "HH:mm", "endTime": "HH:mm", "timeZone": "Asia/Seoul", "title": "제목", "location": "정확한 공식 장소명", "locationAddress": "상세 도로명 주소" }
  },
  "deletedEventId": null,
  "recommendedVenues": [
    {
      "name": "정확한 공식 상호·장소명 (~인근 금지)",
      "category": "업종",
      "address": "시/도 시/군/구 도로명 건물번호 상세 주소",
      "capacityInfo": "수용 인원",
      "priceRange": "가격대",
      "reason": "추천 사유",
      "targetDate": "YYYY-MM-DD"
    }
  ]
}

규칙:
1. 일정 조회 질문이면 actionType="QUERY_EVENTS", createdEvents=[]로 설정하세요.
2. 새 일정 등록이나 첨부 문서/표의 일정 추출이면 actionType="CREATE_EVENT"로 설정하고 createdEvents에 담으세요. 시간이 없으면 10:00~11:00(점심은 12:00~13:30)로 설정하세요. "한국 시간 10시", "10:00 KST", "자카르타 14시" 등 특정 시간대·해외 도시 시각 언급 시 startTime/endTime은 해당 시각 그대로 두고 timeZone에 IANA 시간대(예: Asia/Seoul, Asia/Jakarta, Asia/Makassar)를 기록하세요.
3. 직전/선택 일정 변경은 actionType="UPDATE_EVENT"와 대상 id를 updatedEvent에 담으세요.
4. 일정 삭제는 actionType="DELETE_EVENT"와 deletedEventId에 대상 id를 담으세요.
5. 식당/모임 장소 추천은 actionType="RECOMMEND_VENUE"와 recommendedVenues에 2~3곳을 담으세요.
6. 모든 장소명(location, name)과 주소(locationAddress, address)에서 "~인근", "~근처", "~부근" 같은 모호한 수식어는 절대 사용하지 말고 정확한 공식 장소명과 상세 주소를 분리하여 기재하세요.`;

export function prepareLocalPromptPayload(
  prompt: string,
  context: AgentContext,
  attachments: AgentAttachmentPayload[] = [],
  allowVisionImages = false
): {
  userContent: string;
  inlineImagesBase64: string[];
} {
  const inlineImagesBase64: string[] = [];
  const textBlocks: string[] = [];

  for (const att of attachments) {
    if (att.transferMode === 'text' && att.textContent) {
      textBlocks.push(`[첨부 문서: ${att.name}]\n${att.textContent.slice(0, 12_000)}`);
    } else if (att.transferMode === 'inline') {
      if (att.mimeType.startsWith('image/') && allowVisionImages && att.base64Data) {
        inlineImagesBase64.push(att.base64Data);
        textBlocks.push(`[첨부 이미지: ${att.name}]`);
      } else {
        throw new Error(
          `'${att.name}' (${att.kind.toUpperCase()}) 직접 판독은 Cloud 모델에서 지원됩니다. 모델 선택기에서 Cloud 탭 모델을 선택해 주세요.`
        );
      }
    }
  }

  const compactEvents = context.existingEvents.slice(0, 20).map((e) => ({
    id: e.id,
    title: e.title,
    date: e.date,
    startTime: e.startTime,
    endTime: e.endTime,
    timeZone: e.timeZone,
    category: e.category,
    location: e.location,
    locationAddress: e.locationAddress,
  }));

  const compactContext = {
    currentYear: context.currentYear,
    selectedDate: context.selectedDate,
    viewerTimeZone: context.viewerTimeZone || detectBrowserTimeZone(),
    lastReferencedEvent: context.lastReferencedEvent
      ? {
          id: context.lastReferencedEvent.id,
          title: context.lastReferencedEvent.title,
          date: context.lastReferencedEvent.date,
          startTime: context.lastReferencedEvent.startTime,
          endTime: context.lastReferencedEvent.endTime,
          timeZone: context.lastReferencedEvent.timeZone,
        }
      : null,
    existingEvents: compactEvents,
  };

  const effectivePrompt =
    prompt.trim() ||
    '첨부된 데이터에서 일정, 일시, 장소, 준비 사항을 추출하여 캘린더 일정으로 등록하고 요약해 주세요.';

  const userContent = [
    `[기준 컨텍스트]\n${JSON.stringify(compactContext)}`,
    ...textBlocks,
    `[사용자 요청]\n${effectivePrompt}`,
  ].join('\n\n');

  return { userContent, inlineImagesBase64 };
}

function normalizeCategory(raw: unknown): CalendarCategory {
  if (typeof raw === 'string' && VALID_CATEGORIES.has(raw as CalendarCategory)) {
    return raw as CalendarCategory;
  }
  return '업무';
}

function normalizeTime(raw: unknown, fallback: string): string {
  if (typeof raw === 'string' && /^\d{2}:\d{2}$/.test(raw.trim())) {
    return raw.trim();
  }
  return fallback;
}

function extractFirstJsonObject(raw: string): Record<string, unknown> | null {
  const withoutThink = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const strippedFence = withoutThink
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  try {
    const direct = JSON.parse(strippedFence);
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
      return direct as Record<string, unknown>;
    }
  } catch {
    // 부분 문자열 탐색으로 폴백
  }

  const start = withoutThink.indexOf('{');
  const end = withoutThink.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const sub = JSON.parse(withoutThink.slice(start, end + 1));
      if (sub && typeof sub === 'object' && !Array.isArray(sub)) {
        return sub as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

export function normalizeLocalModelOutput(
  rawText: string,
  prompt: string,
  context: AgentContext
): AgentCommandResponse {
  const cleanedText = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const parsed = extractFirstJsonObject(cleanedText);

  const fallbackDate =
    parseNaturalDateFromText(prompt, context.currentYear) || context.selectedDate;
  const defaultProjectId =
    context.selectedProjectId && context.selectedProjectId !== 'all'
      ? context.selectedProjectId
      : undefined;

  if (!parsed) {
    return {
      success: true,
      actionType: 'GENERAL_CHAT',
      replyText: cleanedText || '요청을 확인했습니다.',
      targetDate: fallbackDate,
      queriedEvents: [],
      freeTimeSlots: [],
      createdEvents: [],
      recommendedVenues: [],
      updatedEvent: null,
      deletedEventId: null,
    };
  }

  const rawAction = String(parsed.actionType || '');
  const actionType: AgentActionType = VALID_ACTIONS.has(rawAction as AgentActionType)
    ? (rawAction as AgentActionType)
    : 'GENERAL_CHAT';

  const targetDate =
    typeof parsed.targetDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.targetDate)
      ? parsed.targetDate
      : fallbackDate;

  const isQuery = actionType === 'QUERY_EVENTS';
  const now = Date.now();

  const safeViewerTz =
    context.viewerTimeZone && isValidTimeZone(context.viewerTimeZone)
      ? context.viewerTimeZone
      : detectBrowserTimeZone();
  const explicitPromptTz = parseExplicitTimeZoneFromText(prompt);

  const createdEvents: CalendarEventItem[] =
    !isQuery && Array.isArray(parsed.createdEvents)
      ? parsed.createdEvents
          .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
          .slice(0, 20)
          .map((ev, idx) => {
            const title =
              typeof ev.title === 'string' && ev.title.trim() ? ev.title.trim() : '새 일정';
            const { location, locationAddress } = normalizePlaceAndAddress(
              ev.location,
              ev.locationAddress
            );
            const modelTz =
              typeof ev.timeZone === 'string' && isValidTimeZone(ev.timeZone.trim())
                ? ev.timeZone.trim()
                : undefined;
            const inferredTz =
              explicitPromptTz ||
              parseExplicitTimeZoneFromText(title) ||
              parseExplicitTimeZoneFromText(location) ||
              parseExplicitTimeZoneFromText(locationAddress) ||
              inferTimeZoneFromLocation(location) ||
              inferTimeZoneFromLocation(locationAddress) ||
              inferTimeZoneFromLocation(title) ||
              undefined;

            return {
              id: typeof ev.id === 'string' && ev.id ? ev.id : `local-evt-${now}-${idx}`,
              title,
              date:
                typeof ev.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ev.date)
                  ? ev.date
                  : targetDate,
              startTime: normalizeTime(ev.startTime, '10:00'),
              endTime: normalizeTime(ev.endTime, '11:00'),
              timeZone: Boolean(ev.isAllDay) ? undefined : modelTz || inferredTz,
              isAllDay: Boolean(ev.isAllDay),
              category: normalizeCategory(ev.category),
              projectId: defaultProjectId,
              location,
              locationAddress,
              content:
                typeof ev.content === 'string' && ev.content.trim()
                  ? ev.content.trim()
                  : undefined,
              isCompleted: false,
            };
          })
      : [];

  const queriedEvents = isQuery
    ? context.existingEvents
        .filter((e) => projectEventToViewerTimeZone(e, safeViewerTz).localDate === targetDate)
        .sort((a, b) => {
          if (a.isAllDay && !b.isAllDay) return -1;
          if (!a.isAllDay && b.isAllDay) return 1;
          const aLocal = projectEventToViewerTimeZone(a, safeViewerTz).localStartTime;
          const bLocal = projectEventToViewerTimeZone(b, safeViewerTz).localStartTime;
          return aLocal.localeCompare(bLocal);
        })
    : [];

  const freeTimeSlots = isQuery
    ? calculateFreeTimeSlots(mapEventsToViewerZone(queriedEvents, safeViewerTz))
    : [];

  let updatedEvent: AgentCommandResponse['updatedEvent'] = null;
  if (
    parsed.updatedEvent &&
    typeof parsed.updatedEvent === 'object' &&
    typeof (parsed.updatedEvent as Record<string, unknown>).id === 'string'
  ) {
    const u = parsed.updatedEvent as Record<string, unknown>;
    const rawUpdates =
      u.updates && typeof u.updates === 'object' ? (u.updates as Record<string, unknown>) : {};
    const updates: Partial<CalendarEventItem> = {};

    if (typeof rawUpdates.title === 'string' && rawUpdates.title.trim()) {
      updates.title = rawUpdates.title.trim();
    }
    if (typeof rawUpdates.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawUpdates.date)) {
      updates.date = rawUpdates.date;
    }
    if (typeof rawUpdates.startTime === 'string' && /^\d{2}:\d{2}$/.test(rawUpdates.startTime)) {
      updates.startTime = rawUpdates.startTime;
    }
    if (typeof rawUpdates.endTime === 'string' && /^\d{2}:\d{2}$/.test(rawUpdates.endTime)) {
      updates.endTime = rawUpdates.endTime;
    }
    if (
      typeof rawUpdates.timeZone === 'string' &&
      isValidTimeZone(rawUpdates.timeZone.trim())
    ) {
      updates.timeZone = rawUpdates.timeZone.trim();
    } else if (explicitPromptTz) {
      updates.timeZone = explicitPromptTz;
    }
    if (typeof rawUpdates.location === 'string' || typeof rawUpdates.locationAddress === 'string') {
      const { location, locationAddress } = normalizePlaceAndAddress(
        rawUpdates.location,
        rawUpdates.locationAddress
      );
      if (typeof rawUpdates.location === 'string') {
        updates.location = location;
      }
      if (typeof rawUpdates.locationAddress === 'string' || locationAddress) {
        updates.locationAddress = locationAddress;
      }
    }
    if (typeof rawUpdates.content === 'string') {
      updates.content = rawUpdates.content.trim();
    }

    updatedEvent = {
      id: String(u.id),
      targetTitle: typeof u.targetTitle === 'string' ? u.targetTitle : '선택 일정',
      diffSummary:
        typeof u.diffSummary === 'string' ? u.diffSummary : '일정 정보가 수정되었습니다.',
      updates,
    };
  }

  const deletedEventId =
    actionType === 'DELETE_EVENT' &&
    typeof parsed.deletedEventId === 'string' &&
    parsed.deletedEventId
      ? parsed.deletedEventId
      : null;

  const recommendedVenues: RecommendedVenue[] = Array.isArray(parsed.recommendedVenues)
    ? parsed.recommendedVenues
        .filter((v): v is Record<string, unknown> => Boolean(v && typeof v === 'object' && typeof v.name === 'string'))
        .slice(0, 5)
        .map((v, idx) => {
          const { location: cleanName, locationAddress: cleanAddr } = normalizePlaceAndAddress(
            v.name,
            v.address
          );
          return {
            id: `local-venue-${now}-${idx}`,
            name: cleanName || String(v.name).trim(),
            category: typeof v.category === 'string' ? v.category.trim() : '추천 장소',
            address: cleanAddr || '도로명 주소 미기재',
            capacityInfo: typeof v.capacityInfo === 'string' ? v.capacityInfo.trim() : '예약 권장',
            priceRange: typeof v.priceRange === 'string' ? v.priceRange.trim() : undefined,
            reason: typeof v.reason === 'string' ? v.reason.trim() : '추천 장소입니다.',
            targetDate,
          };
        })
    : [];

  return {
    success: true,
    actionType,
    replyText:
      typeof parsed.replyText === 'string' && parsed.replyText.trim()
        ? parsed.replyText.trim()
        : '요청을 처리했습니다.',
    targetDate,
    queriedEvents,
    freeTimeSlots,
    createdEvents,
    recommendedVenues,
    updatedEvent,
    deletedEventId,
  };
}
