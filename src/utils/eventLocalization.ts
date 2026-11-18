import i18n, { resources, SupportedLanguageCode } from '../i18n';
import { CanonicalCategoryKey, toCanonicalCategoryKey } from '../constants/categories';
import { formatLocalizedDate } from '../shared/dateUtils';
import { CalendarEventItem, RecurrenceFrequency, RecurrenceRule } from '../types';

export interface FormatEventTitleOptions {
  /** 명시적 로케일 코드 ('ko' | 'en' | 'ja'). 미지정 시 현재 앱 활성 로케일(i18n.language) 사용 */
  locale?: string;
  /** 빈 제목일 때 대체할 사용자 지정 폴백 문자열 */
  fallbackTitle?: string;
  /** 제목 최대 길이 제한 (초과 시 말줄임표 '…' 처리) */
  maxLength?: number;
  /** 외부에서 전달하는 로케일별 제목 매핑 (선택) */
  localizedTitles?: Partial<Record<SupportedLanguageCode, string>>;
}

export interface FormatLocalizedEventOptions {
  /** 명시적 로케일 코드 ('ko' | 'en' | 'ja'). 미지정 시 현재 앱 활성 로케일(i18n.language) 사용 */
  locale?: string;
  /** 타임존 투영이 완료된 시작/종료 시각 */
  projectedTiming?: {
    localDate?: string;
    localStartTime: string;
    localEndTime: string;
  } | null;
  /** 제목 최대 길이 제한 */
  maxTitleLength?: number;
}

export interface LocalizedEventFields {
  locale: SupportedLanguageCode;
  title: string;
  category: string;
  canonicalCategory: CanonicalCategoryKey;
  dateLabel: string;
  endDateLabel?: string;
  timeLabel: string;
  recurrenceLabel: string;
  statusLabel: string;
  locationLabel: string;
  summaryLine: string;
}

const SAMPLE_EVENT_TITLES: Record<string, Partial<Record<SupportedLanguageCode, string>>> = {
  'sample-evt-rd-summit': {
    ko: '차세대 공간 컴퓨팅 공동 연구 협약식',
    en: 'Next-Gen Spatial Computing R&D MOU Ceremony',
    ja: '次世代空間コンピューティング共同研究協定式',
  },
  'sample-evt-vip-luncheon': {
    ko: '20인 파트너스 프라이빗 오찬 모임',
    en: 'Private Partners Luncheon (20 Guests)',
    ja: 'パートナーズ・プライベート昼食会（20名）',
  },
  'sample-evt-keynote-rehearsal': {
    ko: '쇼케이스 키노트 리허설 및 무대 동선 점검',
    en: 'Showcase Keynote Rehearsal & Stage Cue Check',
    ja: 'ショーケース基調講演リハーサル＆ステージ動線確認',
  },
  'sample-evt-global-sync': {
    ko: '동남아 파트너십 현지 브리핑 콜',
    en: 'SEA Partnership Regional Briefing Call',
    ja: '東南アジアパートナーシップ現地ブリーフィングコール',
  },
  'sample-evt-design-freeze': {
    ko: '4분기 마일스톤 아키텍처 리뷰',
    en: 'Q4 Milestone Architecture Review',
    ja: '第4四半期マイルストーン・アーキテクチャレビュー',
  },
};

const MASKED_PLACEHOLDER_PATTERNS = new Set([
  '비공개 일정',
  '일정 있음',
  '외부 비공개 일정',
  'busy',
  'private event',
  'private',
  '非公開の予定',
  '予定あり',
]);

const UNTITLED_FALLBACKS: Record<SupportedLanguageCode, string> = {
  ko: '제목 없는 일정',
  en: 'Untitled Event',
  ja: '無題の予定',
};

const MASKED_EVENT_LABELS: Record<SupportedLanguageCode, string> = {
  ko: '비공개 일정',
  en: 'Private Event',
  ja: '非公開の予定',
};

const STATUS_LABELS: Record<SupportedLanguageCode, { completed: string; scheduled: string }> = {
  ko: { completed: '완료', scheduled: '예정' },
  en: { completed: 'Completed', scheduled: 'Scheduled' },
  ja: { completed: '完了', scheduled: '予定' },
};

/**
 * 임의의 언어 태그(예: 'en-US', 'ja-JP', 'ko-KR')를 앱 지원 로케일('ko' | 'en' | 'ja')로 정규화
 */
export function normalizeAppLocale(locale?: string | null): SupportedLanguageCode {
  const raw = (locale || i18n.language || 'ko').trim().toLowerCase();
  if (raw.startsWith('en')) return 'en';
  if (raw.startsWith('ja')) return 'ja';
  return 'ko';
}

function truncateWithEllipsis(text: string, maxLength?: number): string {
  if (!maxLength || maxLength <= 0 || text.length <= maxLength) {
    return text;
  }
  if (maxLength === 1) return '…';
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

/**
 * 캘린더 일정의 'category' 필드를 현재(또는 지정) 애플리케이션 로케일에 맞춰 포맷·현지화
 */
export function formatLocalizedEventCategory(
  category?: string | null,
  locale?: string | null
): string {
  const lang = normalizeAppLocale(locale);
  const canonical = toCanonicalCategoryKey(category);
  const dict = resources[lang]?.calendar?.categories;
  return dict?.[canonical] || resources.ko.calendar.categories[canonical] || category || '';
}

/**
 * 캘린더 일정의 'title' 필드를 현재(또는 지정) 애플리케이션 로케일에 맞춰 포맷·현지화
 * - 빈 제목/공백 정규화 및 로케일별 폴백 제공
 * - 마스킹된 외부 일정 기본 플레이스홀더 현지화
 * - 내장 샘플 일정(sample-evt-*) 다국어 제목 자동 매핑
 */
export function formatLocalizedEventTitle(
  eventOrTitle:
    | Pick<CalendarEventItem, 'id' | 'title' | 'externalSync' | 'isSample'>
    | string
    | null
    | undefined,
  options?: FormatEventTitleOptions
): string {
  const lang = normalizeAppLocale(options?.locale);
  const rawTitle =
    typeof eventOrTitle === 'string'
      ? eventOrTitle
      : eventOrTitle?.title ?? '';
  const cleaned = rawTitle.replace(/\s+/g, ' ').trim();

  if (options?.localizedTitles?.[lang]) {
    return truncateWithEllipsis(options.localizedTitles[lang]!, options.maxLength);
  }

  if (eventOrTitle && typeof eventOrTitle !== 'string') {
    const sampleMap = SAMPLE_EVENT_TITLES[eventOrTitle.id];
    if (sampleMap) {
      const sampleKo = sampleMap.ko;
      // 사용자가 샘플 제목을 직접 수정하지 않은 경우에만 선택 로케일로 표시
      if (!sampleKo || cleaned === sampleKo) {
        const localizedSample = sampleMap[lang] || cleaned || sampleKo;
        if (localizedSample) {
          return truncateWithEllipsis(localizedSample, options?.maxLength);
        }
      }
    }

    if (
      eventOrTitle.externalSync?.isMasked &&
      (!cleaned || MASKED_PLACEHOLDER_PATTERNS.has(cleaned.toLowerCase()))
    ) {
      return truncateWithEllipsis(MASKED_EVENT_LABELS[lang], options?.maxLength);
    }
  }

  if (!cleaned) {
    const fallback = options?.fallbackTitle?.trim() || UNTITLED_FALLBACKS[lang];
    return truncateWithEllipsis(fallback, options?.maxLength);
  }

  return truncateWithEllipsis(cleaned, options?.maxLength);
}

/**
 * 반복 규칙(RecurrenceRule)을 선택된 로케일 문자열로 포맷
 */
export function formatLocalizedRecurrenceLabel(
  rule?: RecurrenceRule | null,
  locale?: string | null
): string {
  const lang = normalizeAppLocale(locale);
  const recDict = resources[lang].calendar.recurrence;

  if (!rule) {
    return recDict.none;
  }

  const freqKey = rule.frequency as RecurrenceFrequency;
  const freqLabel = recDict[freqKey] || recDict.none;

  if (rule.until) {
    if (lang === 'en') return `${freqLabel} · Until ${rule.until}`;
    if (lang === 'ja') return `${freqLabel} · ${rule.until}まで`;
    return `${freqLabel} · ${rule.until}까지`;
  }

  if (rule.count) {
    if (lang === 'en') return `${freqLabel} · ${rule.count} times`;
    if (lang === 'ja') return `${freqLabel} · 全${rule.count}回`;
    return `${freqLabel} · 총 ${rule.count}회`;
  }

  return freqLabel;
}

/**
 * 일정의 시간 범위(종일 또는 HH:mm – HH:mm)를 로케일에 맞춰 포맷
 */
export function formatLocalizedEventTimeRange(
  event: Pick<CalendarEventItem, 'isAllDay' | 'startTime' | 'endTime'>,
  locale?: string | null,
  projectedTiming?: { localStartTime: string; localEndTime: string } | null
): string {
  const lang = normalizeAppLocale(locale);
  if (event.isAllDay) {
    return resources[lang].calendar.allDay;
  }
  const start = projectedTiming?.localStartTime ?? event.startTime;
  const end = projectedTiming?.localEndTime ?? event.endTime;
  return `${start} – ${end}`;
}

/**
 * 캘린더 일정 객체의 핵심 표시 필드(title, category, dateLabel, timeLabel, recurrenceLabel 등)를
 * 애플리케이션 활성 로케일 기준으로 일괄 포맷·현지화하여 반환
 */
export function formatLocalizedEventFields(
  event: CalendarEventItem,
  options?: FormatLocalizedEventOptions
): LocalizedEventFields {
  const lang = normalizeAppLocale(options?.locale);
  const title = formatLocalizedEventTitle(event, {
    locale: lang,
    maxLength: options?.maxTitleLength,
  });
  const canonicalCategory = toCanonicalCategoryKey(event.category);
  const category = formatLocalizedEventCategory(event.category, lang);

  const effectiveDate = options?.projectedTiming?.localDate || event.date;
  const dateLabel = formatLocalizedDate(effectiveDate, lang);
  const endDateLabel =
    event.endDate && event.endDate !== effectiveDate
      ? formatLocalizedDate(event.endDate, lang)
      : undefined;

  const timeLabel = formatLocalizedEventTimeRange(event, lang, options?.projectedTiming);
  const recurrenceLabel = formatLocalizedRecurrenceLabel(event.recurrence, lang);
  const statusLabel = event.isCompleted
    ? STATUS_LABELS[lang].completed
    : STATUS_LABELS[lang].scheduled;

  const locationLabel = (event.location || event.locationAddress || '').replace(/\s+/g, ' ').trim();
  const summaryParts = [
    `[${category}]`,
    title,
    `${dateLabel} (${timeLabel})`,
    locationLabel ? `@ ${locationLabel}` : '',
  ].filter(Boolean);

  return {
    locale: lang,
    title,
    category,
    canonicalCategory,
    dateLabel,
    ...(endDateLabel ? { endDateLabel } : {}),
    timeLabel,
    recurrenceLabel,
    statusLabel,
    locationLabel,
    summaryLine: summaryParts.join(' '),
  };
}
