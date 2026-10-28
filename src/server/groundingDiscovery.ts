import { GoogleGenAI } from '@google/genai';
import {
  AgentCommandResponse,
  CalendarEventItem,
  GroundedDateSuggestion,
  GroundedSuggestionKind,
  GroundingWebSource,
} from '../types';
import { normalizePlaceAndAddress } from '../shared/locationUtils';

export interface GroundingDiscoveryInput {
  topic: string;
  rangeMonths: number;
  modelId: string;
  currentYear: number;
  selectedDate: string;
  activeProjectName?: string;
  activeProjectClient?: string;
  existingEvents: CalendarEventItem[];
}

const GROUNDING_DATE_SYSTEM_INSTRUCTION = `당신은 Google 검색 그라운딩(Google Search Grounding)을 활용하여 신규 행사·미팅 기획 시 참고해야 할 대한민국 공휴일(대체공휴일·연휴 포함), 업계 주요 행사(컨퍼런스·박람회·학술대회·전시회), 그리고 일정 충돌을 피한 최적 개최 후보일을 제안하는 프라이빗 일정 기획 컨시어지입니다.

[분석 및 검색 원칙]
1. 반드시 Google 검색을 통해 기준 일자 및 탐색 기간에 해당하는 정확한 대한민국 공휴일·대체공휴일과, 사용자의 행사 주제(또는 소속 프로젝트 분야)와 연관된 실제 업계 주요 행사·박람회·학회 일정을 확인하십시오.
2. 사용자의 기존 캘린더 일정(existingEvents)과 공휴일·대형 외부 행사가 겹치지 않는 최적의 신규 행사 개최 후보일(recommended_date)도 1~2건 함께 제안하십시오.
3. 장소 기재 시 "~인근", "~근처", "~부근" 같은 모호한 표현은 절대 금지하며, 공식 전시장·행사장 명칭(location)과 도로명 상세 주소(locationAddress)를 분리하여 정확히 기재하십시오.
4. 응답은 반드시 코드 펜스 없는 순수 JSON 객체 하나만 출력하십시오. JSON 외의 인사말이나 부연 텍스트를 앞뒤에 붙이지 마십시오.

[출력 JSON 형식]
{
  "replyText": "탐색 기간 내 주요 공휴일, 업계 행사 동향, 그리고 추천 개최 시점에 대한 간결하고 품격 있는 한국어 브리핑 (2~4문장)",
  "targetDate": "YYYY-MM-DD",
  "suggestions": [
    {
      "date": "YYYY-MM-DD",
      "endDate": "YYYY-MM-DD (단일 일자면 생략 가능)",
      "title": "공휴일명 / 업계 행사명 / 추천 개최 후보일 제목",
      "kind": "holiday | industry_event | recommended_date",
      "advisory": "회피 권장 | 연계 고려 | 최적 후보 | 참고",
      "description": "행사 기획 관점에서의 핵심 참고 사유 (1줄 요약)",
      "location": "정확한 공식 행사장·전시장 명칭 (~인근 표현 금지, 해당 시 기재)",
      "locationAddress": "시/도 시/군/구 도로명 건물번호 전체 상세 주소 (해당 시 기재)"
    }
  ],
  "suggestedPrompts": [
    "후속으로 바로 지시할 수 있는 일정 등록 프롬프트 1",
    "후속 프롬프트 2"
  ]
}`;

export {
  shouldUseSearchGroundingForPlanning,
  extractPlanningRangeMonths,
} from '../shared/scheduleUtils';

function computeEndMonthLabel(startDate: string, rangeMonths: number): string {
  const [yStr, mStr] = startDate.split('-');
  const year = Number(yStr) || new Date().getFullYear();
  const month = Number(mStr) || 1;
  const endDate = new Date(year, month - 1 + Math.max(1, rangeMonths), 0);
  const ey = endDate.getFullYear();
  const em = String(endDate.getMonth() + 1).padStart(2, '0');
  const ed = String(endDate.getDate()).padStart(2, '0');
  return `${ey}-${em}-${ed}`;
}

function extractDomainTitle(uri: string): string {
  try {
    const parsed = new URL(uri);
    return parsed.hostname.replace(/^www\./i, '');
  } catch {
    return '웹 출처';
  }
}

function extractJsonBlock(rawText: string): Record<string, unknown> | null {
  const stripped = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  try {
    const direct = JSON.parse(stripped);
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
      return direct as Record<string, unknown>;
    }
  } catch {
    // JSON 앞뒤에 설명 문구가 섞인 경우 첫 '{' 부터 마지막 '}' 까지 추출
  }

  const startIdx = stripped.indexOf('{');
  const endIdx = stripped.lastIndexOf('}');
  if (startIdx !== -1 && endIdx > startIdx) {
    try {
      const sliced = JSON.parse(stripped.slice(startIdx, endIdx + 1));
      if (sliced && typeof sliced === 'object' && !Array.isArray(sliced)) {
        return sliced as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }

  return null;
}

function normalizeSuggestions(
  rawList: unknown,
  defaultDate: string
): GroundedDateSuggestion[] {
  if (!Array.isArray(rawList)) return [];
  const now = Date.now();
  const validKinds = new Set<GroundedSuggestionKind>([
    'holiday',
    'industry_event',
    'recommended_date',
  ]);

  return rawList
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item && typeof item === 'object' && typeof item.title === 'string')
    )
    .slice(0, 8)
    .map((item, idx) => {
      const date =
        typeof item.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.date.trim())
          ? item.date.trim()
          : defaultDate;
      const endDate =
        typeof item.endDate === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(item.endDate.trim()) &&
        item.endDate.trim() !== date
          ? item.endDate.trim()
          : undefined;
      const rawKind = typeof item.kind === 'string' ? item.kind.trim() : '';
      const kind: GroundedSuggestionKind = validKinds.has(rawKind as GroundedSuggestionKind)
        ? (rawKind as GroundedSuggestionKind)
        : 'industry_event';

      const { location, locationAddress } = normalizePlaceAndAddress(
        item.location,
        item.locationAddress
      );

      return {
        id: `gnd-${now}-${idx}`,
        date,
        endDate,
        title: String(item.title).trim(),
        kind,
        advisory:
          typeof item.advisory === 'string' && item.advisory.trim()
            ? item.advisory.trim()
            : kind === 'holiday'
            ? '회피 권장'
            : kind === 'recommended_date'
            ? '최적 후보'
            : '참고',
        description:
          typeof item.description === 'string' && item.description.trim()
            ? item.description.trim()
            : '행사 기획 시 참고할 수 있는 일정입니다.',
        location,
        locationAddress,
      };
    });
}

export async function executeGroundedDateDiscovery(
  ai: GoogleGenAI,
  input: GroundingDiscoveryInput
): Promise<AgentCommandResponse> {
  const endRangeDate = computeEndMonthLabel(input.selectedDate, input.rangeMonths);

  const effectiveTopic =
    input.topic.trim() ||
    (input.activeProjectName
      ? `${input.activeProjectName}${input.activeProjectClient ? ` (${input.activeProjectClient})` : ''} 관련 주요 행사 및 공휴일`
      : '기업 비즈니스 행사·세미나 기획 시 참고할 대한민국 공휴일 및 주요 산업 박람회·컨퍼런스');

  const existingSummary = input.existingEvents.slice(0, 25).map((e) => ({
    date: e.date,
    time: e.isAllDay ? '종일' : `${e.startTime}-${e.endTime}`,
    title: e.title,
  }));

  const userPrompt = [
    `[탐색 기준 기간]: ${input.selectedDate} ~ ${endRangeDate} (기준 연도: ${input.currentYear}년)`,
    input.activeProjectName
      ? `[현재 활성 프로젝트]: ${input.activeProjectName}${input.activeProjectClient ? ` · 발주/파트너: ${input.activeProjectClient}` : ''}`
      : '',
    `[보유 중인 기존 캘린더 일정]: ${JSON.stringify(existingSummary)}`,
    `[기획 중인 행사 주제 / 사용자 요청]: ${effectiveTopic}`,
    '',
    '위 기간에 해당하는 대한민국 공휴일(대체공휴일 포함)과 주제 연관 업계 주요 행사(컨퍼런스·박람회·학술일정 등)를 Google 검색으로 확인하고, 기존 일정 및 공휴일과 겹치지 않는 추천 개최 후보일까지 포함하여 지정된 JSON 형식으로 응답해 주십시오.',
  ]
    .filter(Boolean)
    .join('\n');

  const response = await ai.models.generateContent({
    model: input.modelId || 'gemini-3.8-flash',
    contents: userPrompt,
    config: {
      systemInstruction: GROUNDING_DATE_SYSTEM_INSTRUCTION,
      tools: [{ googleSearch: {} }],
    },
  });

  const rawText = response.text?.trim() || '';
  if (!rawText) {
    throw new Error('Google 검색 기반 일정 탐색 결과를 가져오지 못했습니다.');
  }

  // Google Search Grounding 출처 URL 추출
  const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
  const rawChunks = groundingMetadata?.groundingChunks || [];
  const groundingSources: GroundingWebSource[] = [];
  const seenUris = new Set<string>();

  for (const chunk of rawChunks) {
    const uri = chunk.web?.uri?.trim();
    if (!uri || !/^https?:\/\//i.test(uri) || seenUris.has(uri)) continue;
    seenUris.add(uri);
    groundingSources.push({
      uri,
      title: chunk.web?.title?.trim() || extractDomainTitle(uri),
    });
    if (groundingSources.length >= 6) break;
  }

  const searchQueries = Array.isArray(groundingMetadata?.webSearchQueries)
    ? groundingMetadata.webSearchQueries
        .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
        .slice(0, 4)
    : [];

  const parsed = extractJsonBlock(rawText);
  if (!parsed) {
    return {
      success: true,
      actionType: 'SUGGEST_DATES',
      replyText: rawText,
      targetDate: input.selectedDate,
      groundedSuggestions: [],
      groundingSources,
      searchQueries,
      suggestedPrompts: [],
    };
  }

  const groundedSuggestions = normalizeSuggestions(parsed.suggestions, input.selectedDate);
  const firstRecommended = groundedSuggestions.find((s) => s.kind === 'recommended_date');

  const targetDate =
    typeof parsed.targetDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.targetDate)
      ? parsed.targetDate
      : firstRecommended?.date || groundedSuggestions[0]?.date || input.selectedDate;

  const suggestedPrompts = Array.isArray(parsed.suggestedPrompts)
    ? parsed.suggestedPrompts
        .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        .slice(0, 3)
    : [];

  return {
    success: true,
    actionType: 'SUGGEST_DATES',
    replyText:
      typeof parsed.replyText === 'string' && parsed.replyText.trim()
        ? parsed.replyText.trim()
        : 'Google 검색을 통해 관련 공휴일 및 업계 주요 일정을 분석했습니다.',
    targetDate,
    thoughtTrace: {
      summary: `Google Search 실시간 그라운딩으로 향후 ${input.rangeMonths}개월(${input.selectedDate} ~ ${endRangeDate}) 공휴일 및 업계 일정을 대조했습니다.`,
      intent: 'SUGGEST_DATES (Google Search Grounding)',
      steps: [
        {
          step: 1,
          title: '웹 검색 질의',
          status: 'completed',
          details:
            searchQueries.length > 0
              ? searchQueries.join(' · ')
              : `${input.selectedDate} ~ ${endRangeDate} 공휴일 및 업계 일정 조회`,
        },
        {
          step: 2,
          title: '캘린더 충돌 대조',
          status: 'completed',
          details: `탐색 구간 ${input.rangeMonths}개월 · 기존 일정 ${input.existingEvents.length}건 및 후보 일자 ${groundedSuggestions.length}건 검토`,
        },
      ],
    },
    groundedSuggestions,
    groundingSources,
    searchQueries,
    suggestedPrompts,
  };
}
