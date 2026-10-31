import { CalendarEventItem } from '../types';

export type EventHistoryActionKind =
  | 'create'
  | 'update'
  | 'move'
  | 'complete'
  | 'checklist'
  | 'delete'
  | 'ai'
  | 'rebalance'
  | 'import'
  | 'restore';

export interface EventHistoryEntry {
  id: string;
  timestamp: string;
  kind: EventHistoryActionKind;
  label: string;
  detail?: string;
  targetEventId?: string;
  targetEventTitle?: string;
  focusDate?: string;
  beforeEvents: CalendarEventItem[];
  afterEvents: CalendarEventItem[];
}

export function cloneEventItem(ev: CalendarEventItem): CalendarEventItem {
  return {
    ...ev,
    checklist: ev.checklist ? ev.checklist.map((item) => ({ ...item })) : undefined,
    recurrence: ev.recurrence ? { ...ev.recurrence } : undefined,
    excludedDates: ev.excludedDates ? [...ev.excludedDates] : undefined,
    completedDates: ev.completedDates ? [...ev.completedDates] : undefined,
  };
}

export function cloneEventsList(list: CalendarEventItem[]): CalendarEventItem[] {
  return list.map(cloneEventItem);
}

function areStringArraysEqual(a?: string[], b?: string[]): boolean {
  const lenA = a?.length ?? 0;
  const lenB = b?.length ?? 0;
  if (lenA !== lenB) return false;
  if (!a || !b) return true;
  for (let i = 0; i < lenA; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function areChecklistsEqual(
  a?: CalendarEventItem['checklist'],
  b?: CalendarEventItem['checklist']
): boolean {
  const lenA = a?.length ?? 0;
  const lenB = b?.length ?? 0;
  if (lenA !== lenB) return false;
  if (!a || !b) return true;
  for (let i = 0; i < lenA; i += 1) {
    if (a[i].id !== b[i].id || a[i].text !== b[i].text || a[i].done !== b[i].done) {
      return false;
    }
  }
  return true;
}

export function areSingleEventsEqual(a: CalendarEventItem, b: CalendarEventItem): boolean {
  return (
    a.id === b.id &&
    a.title === b.title &&
    a.date === b.date &&
    a.endDate === b.endDate &&
    a.startTime === b.startTime &&
    a.endTime === b.endTime &&
    a.timeZone === b.timeZone &&
    a.isAllDay === b.isAllDay &&
    a.category === b.category &&
    a.projectId === b.projectId &&
    a.location === b.location &&
    a.locationAddress === b.locationAddress &&
    a.locationLat === b.locationLat &&
    a.locationLng === b.locationLng &&
    a.content === b.content &&
    Boolean(a.isCompleted) === Boolean(b.isCompleted) &&
    a.recurrence?.frequency === b.recurrence?.frequency &&
    a.recurrence?.until === b.recurrence?.until &&
    a.recurrence?.count === b.recurrence?.count &&
    areStringArraysEqual(a.excludedDates, b.excludedDates) &&
    areStringArraysEqual(a.completedDates, b.completedDates) &&
    areChecklistsEqual(a.checklist, b.checklist)
  );
}

export function areEventsSnapshotsEqual(
  a: CalendarEventItem[],
  b: CalendarEventItem[]
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (!areSingleEventsEqual(a[i], b[i])) return false;
  }
  return true;
}

function formatSlotShort(ev: CalendarEventItem): string {
  const shortDate = ev.date.length >= 10 ? ev.date.slice(5) : ev.date;
  const endSuffix =
    ev.endDate && ev.endDate > ev.date ? `~${ev.endDate.slice(5)}` : '';
  if (ev.isAllDay) {
    return `${shortDate}${endSuffix} 종일`;
  }
  return `${shortDate}${endSuffix} ${ev.startTime}~${ev.endTime}`;
}

export function describeEventFieldChanges(
  before: CalendarEventItem,
  after: CalendarEventItem
): string {
  const diffs: string[] = [];

  if (before.title !== after.title) {
    diffs.push(`제목 '${before.title}' → '${after.title}'`);
  }

  if (
    before.date !== after.date ||
    before.endDate !== after.endDate ||
    before.startTime !== after.startTime ||
    before.endTime !== after.endTime ||
    before.isAllDay !== after.isAllDay
  ) {
    diffs.push(`${formatSlotShort(before)} → ${formatSlotShort(after)}`);
  }

  if (before.category !== after.category) {
    diffs.push(`분류 ${before.category} → ${after.category}`);
  }

  if (before.projectId !== after.projectId) {
    diffs.push(after.projectId ? '소속 프로젝트 변경' : '프로젝트 연결 해제');
  }

  if (before.timeZone !== after.timeZone) {
    diffs.push(`시간대 ${before.timeZone || '기본'} → ${after.timeZone || '기본'}`);
  }

  if (
    before.location !== after.location ||
    before.locationAddress !== after.locationAddress ||
    before.locationLat !== after.locationLat ||
    before.locationLng !== after.locationLng
  ) {
    diffs.push(
      after.location
        ? `장소 '${after.location}'`
        : after.locationAddress
        ? '상세 주소 수정'
        : '장소 정보 비움'
    );
  }

  if (before.content !== after.content) {
    diffs.push(after.content ? '상세 메모 수정' : '상세 메모 비움');
  }

  if (
    before.recurrence?.frequency !== after.recurrence?.frequency ||
    before.recurrence?.until !== after.recurrence?.until ||
    before.recurrence?.count !== after.recurrence?.count
  ) {
    diffs.push(after.recurrence ? '반복 주기 설정' : '반복 해제');
  }

  if (
    Boolean(before.isCompleted) !== Boolean(after.isCompleted) ||
    !areStringArraysEqual(before.completedDates, after.completedDates)
  ) {
    diffs.push(after.isCompleted ? '완료 처리' : '완료 상태 변경');
  }

  if (!areChecklistsEqual(before.checklist, after.checklist)) {
    const beforeDone = (before.checklist || []).filter((c) => c.done).length;
    const afterDone = (after.checklist || []).filter((c) => c.done).length;
    const beforeTotal = (before.checklist || []).length;
    const afterTotal = (after.checklist || []).length;
    diffs.push(`체크리스트 ${beforeDone}/${beforeTotal} → ${afterDone}/${afterTotal}`);
  }

  return diffs.slice(0, 2).join(' · ') || '세부 항목 변경';
}

export function formatHistoryTimestamp(isoString: string): string {
  const dt = new Date(isoString);
  if (Number.isNaN(dt.getTime())) return '';
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  const ss = String(dt.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}
