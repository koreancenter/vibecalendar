import * as Y from 'yjs';
import { CalendarCategory } from '../types';
import {
  ShareCardTheme,
  SharedEventPassData,
  SharedPassPayload,
} from '../utils/shareCodec';
import {
  CollaborativeSharePassView,
  CrdtChecklistEntry,
  CrdtCollaborativeEventItem,
  CrdtCommentEntry,
  CrdtEventRsvpEntry,
  CrdtProposedSlotItem,
  CrdtSlotVoteEntry,
  SharePassRsvpStatus,
  SharePassSlotVoteStatus,
} from '../shared/yjsCollabProtocol';

export const YJS_LOCAL_ORIGIN = 'local-crdt-ui';

function getMetaMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap('meta');
}

function getSharedNotesText(doc: Y.Doc): Y.Text {
  return doc.getText('sharedNotes');
}

function getEventsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('eventsById') as Y.Map<Y.Map<unknown>>;
}

function getSlotsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('proposedSlotsById') as Y.Map<Y.Map<unknown>>;
}

function getCommentsArray(doc: Y.Doc): Y.Array<CrdtCommentEntry> {
  return doc.getArray<CrdtCommentEntry>('comments');
}

function populateIntegratedYEventMap(
  evMap: Y.Map<unknown>,
  ev: SharedEventPassData,
  actorName: string,
  nowIso: string
): {
  checklistMap: Y.Map<CrdtChecklistEntry>;
  rsvpsMap: Y.Map<CrdtEventRsvpEntry>;
} {
  evMap.set('id', ev.id);
  evMap.set('sourceLocalEventId', ev.id);
  evMap.set('title', ev.title);
  evMap.set('date', ev.date);
  evMap.set('endDate', ev.endDate || '');
  evMap.set('startTime', ev.startTime);
  evMap.set('endTime', ev.endTime);
  evMap.set('timeZone', ev.timeZone);
  evMap.set('isAllDay', Boolean(ev.isAllDay));
  evMap.set('category', ev.category);
  evMap.set('projectName', ev.projectName || '');
  evMap.set('location', ev.location || '');
  evMap.set('locationAddress', ev.locationAddress || '');
  if (typeof ev.locationLat === 'number') evMap.set('locationLat', ev.locationLat);
  if (typeof ev.locationLng === 'number') evMap.set('locationLng', ev.locationLng);
  evMap.set('content', ev.content || '');
  evMap.set('isCompleted', false);
  evMap.set('lastEditedBy', actorName);
  evMap.set('updatedAt', nowIso);

  const checklistMap = new Y.Map<CrdtChecklistEntry>();
  evMap.set('checklist', checklistMap);
  if (ev.checklist && ev.checklist.length > 0) {
    ev.checklist.forEach((chk, idx) => {
      const itemId = chk.id || `chk_${idx + 1}`;
      checklistMap.set(itemId, {
        id: itemId,
        text: chk.text,
        done: Boolean(chk.done),
        updatedBy: actorName,
        updatedAt: nowIso,
      });
    });
  }

  const rsvpsMap = new Y.Map<CrdtEventRsvpEntry>();
  evMap.set('rsvps', rsvpsMap);

  return { checklistMap, rsvpsMap };
}

/**
 * Seeds a fresh Y.Doc from a SharePass payload (`event` or `project`).
 */
export function initializeYDocFromSharePayload(
  doc: Y.Doc,
  payload: SharedPassPayload,
  host: { participantId: string; displayName: string; colorHex: string; timeZone: string }
): void {
  const nowIso = new Date().toISOString();

  doc.transact(() => {
    const meta = getMetaMap(doc);
    const notesText = getSharedNotesText(doc);
    const eventsMap = getEventsMap(doc);
    const slotsMap = getSlotsMap(doc);

    meta.set('kind', payload.kind);
    meta.set('theme', payload.theme || 'obsidian');
    meta.set('senderNote', payload.senderNote || '');
    meta.set('issuedAt', payload.issuedAt || nowIso.slice(0, 10));
    meta.set('hostParticipantId', host.participantId);
    meta.set('hostDisplayName', host.displayName);
    meta.set('finalizedSlotId', null);

    if (payload.kind === 'event' && payload.event) {
      const ev = payload.event;
      meta.set('title', ev.title);
      meta.set('subtitle', ev.projectName || '');
      meta.set('sourceTimeZone', ev.timeZone || host.timeZone);

      const evMap = new Y.Map<unknown>();
      eventsMap.set(ev.id, evMap);
      const { rsvpsMap } = populateIntegratedYEventMap(evMap, ev, host.displayName, nowIso);

      // Host defaults to attending on their own shared event
      rsvpsMap.set(host.participantId, {
        participantId: host.participantId,
        displayName: host.displayName,
        colorHex: host.colorHex,
        timeZone: host.timeZone,
        status: 'attending',
        updatedAt: nowIso,
      });

      if (ev.proposedSlots && ev.proposedSlots.length > 0) {
        ev.proposedSlots.forEach((slot, idx) => {
          const slotId = `slot_${idx + 1}`;
          const slotMap = new Y.Map<unknown>();
          slotsMap.set(slotId, slotMap);
          slotMap.set('id', slotId);
          slotMap.set('date', slot.date);
          slotMap.set('startTime', slot.startTime);
          slotMap.set('endTime', slot.endTime);
          slotMap.set('timeZone', ev.timeZone || host.timeZone);
          slotMap.set('label', slot.label || '');
          slotMap.set('createdBy', host.displayName);

          const votesMap = new Y.Map<CrdtSlotVoteEntry>();
          slotMap.set('votes', votesMap);
          votesMap.set(host.participantId, {
            participantId: host.participantId,
            displayName: host.displayName,
            colorHex: host.colorHex,
            timeZone: host.timeZone,
            status: 'available',
            updatedAt: nowIso,
          });
        });
      }

      if (ev.content) {
        notesText.insert(0, ev.content);
      }
    } else if (payload.kind === 'project' && payload.project) {
      const pr = payload.project;
      meta.set('title', pr.name);
      meta.set('subtitle', pr.description || '');
      meta.set('projectCode', pr.code || '');
      meta.set('clientOrOrg', pr.clientOrOrg || '');
      meta.set('startDate', pr.startDate || '');
      meta.set('endDate', pr.endDate || '');
      meta.set('sourceTimeZone', pr.events[0]?.timeZone || host.timeZone);

      pr.events.forEach((ev) => {
        const evMap = new Y.Map<unknown>();
        eventsMap.set(ev.id, evMap);
        populateIntegratedYEventMap(evMap, ev, host.displayName, nowIso);
      });

      if (pr.description) {
        notesText.insert(0, pr.description);
      }
    }
  }, YJS_LOCAL_ORIGIN);
}

/**
 * Projects the current CRDT Y.Doc state into an immutable React-friendly view snapshot.
 */
export function readWorkspaceViewFromYDoc(doc: Y.Doc): CollaborativeSharePassView {
  const meta = getMetaMap(doc);
  const notesText = getSharedNotesText(doc);
  const eventsMap = getEventsMap(doc);
  const slotsMap = getSlotsMap(doc);
  const commentsArr = getCommentsArray(doc);

  const events: CrdtCollaborativeEventItem[] = [];
  eventsMap.forEach((evMap, key) => {
    if (!(evMap instanceof Y.Map)) return;
    const checklistMap = evMap.get('checklist');
    const checklist: CrdtChecklistEntry[] = [];
    if (checklistMap instanceof Y.Map) {
      checklistMap.forEach((val) => {
        if (val && typeof val === 'object') {
          checklist.push(val as CrdtChecklistEntry);
        }
      });
    }
    checklist.sort((a, b) => a.id.localeCompare(b.id));

    const rsvpsMap = evMap.get('rsvps');
    const rsvps: Record<string, CrdtEventRsvpEntry> = {};
    if (rsvpsMap instanceof Y.Map) {
      rsvpsMap.forEach((val, pid) => {
        if (val && typeof val === 'object') {
          rsvps[pid] = val as CrdtEventRsvpEntry;
        }
      });
    }

    events.push({
      id: String(evMap.get('id') || key),
      sourceLocalEventId: evMap.get('sourceLocalEventId')
        ? String(evMap.get('sourceLocalEventId'))
        : undefined,
      title: String(evMap.get('title') || '일정'),
      date: String(evMap.get('date') || '2026-01-01'),
      endDate: evMap.get('endDate') ? String(evMap.get('endDate')) : undefined,
      startTime: String(evMap.get('startTime') || '09:00'),
      endTime: String(evMap.get('endTime') || '10:00'),
      timeZone: String(evMap.get('timeZone') || 'Asia/Seoul'),
      isAllDay: Boolean(evMap.get('isAllDay')),
      category: (evMap.get('category') as CalendarCategory) || '업무',
      projectName: evMap.get('projectName') ? String(evMap.get('projectName')) : undefined,
      location: evMap.get('location') ? String(evMap.get('location')) : undefined,
      locationAddress: evMap.get('locationAddress')
        ? String(evMap.get('locationAddress'))
        : undefined,
      locationLat:
        typeof evMap.get('locationLat') === 'number'
          ? (evMap.get('locationLat') as number)
          : undefined,
      locationLng:
        typeof evMap.get('locationLng') === 'number'
          ? (evMap.get('locationLng') as number)
          : undefined,
      content: evMap.get('content') ? String(evMap.get('content')) : undefined,
      isCompleted: Boolean(evMap.get('isCompleted')),
      lastEditedBy: evMap.get('lastEditedBy') ? String(evMap.get('lastEditedBy')) : undefined,
      updatedAt: String(evMap.get('updatedAt') || ''),
      checklist,
      rsvps,
    });
  });

  events.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.isAllDay && !b.isAllDay) return -1;
    if (!a.isAllDay && b.isAllDay) return 1;
    return a.startTime.localeCompare(b.startTime);
  });

  const proposedSlots: CrdtProposedSlotItem[] = [];
  slotsMap.forEach((slotMap, key) => {
    if (!(slotMap instanceof Y.Map)) return;
    const votesMap = slotMap.get('votes');
    const votes: Record<string, CrdtSlotVoteEntry> = {};
    if (votesMap instanceof Y.Map) {
      votesMap.forEach((val, pid) => {
        if (val && typeof val === 'object') {
          votes[pid] = val as CrdtSlotVoteEntry;
        }
      });
    }
    proposedSlots.push({
      id: String(slotMap.get('id') || key),
      date: String(slotMap.get('date') || '2026-01-01'),
      startTime: String(slotMap.get('startTime') || '10:00'),
      endTime: String(slotMap.get('endTime') || '11:00'),
      timeZone: String(slotMap.get('timeZone') || 'Asia/Seoul'),
      label: slotMap.get('label') ? String(slotMap.get('label')) : undefined,
      createdBy: String(slotMap.get('createdBy') || '참여자'),
      votes,
    });
  });

  proposedSlots.sort(
    (a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)
  );

  const comments = commentsArr.toArray().slice(-200);

  return {
    kind: meta.get('kind') === 'project' ? 'project' : 'event',
    title: String(meta.get('title') || '공동편집 일정 브리핑'),
    subtitle: meta.get('subtitle') ? String(meta.get('subtitle')) : undefined,
    projectCode: meta.get('projectCode') ? String(meta.get('projectCode')) : undefined,
    clientOrOrg: meta.get('clientOrOrg') ? String(meta.get('clientOrOrg')) : undefined,
    startDate: meta.get('startDate') ? String(meta.get('startDate')) : undefined,
    endDate: meta.get('endDate') ? String(meta.get('endDate')) : undefined,
    theme: meta.get('theme') === 'editorial' ? 'editorial' : 'obsidian',
    senderNote: String(meta.get('senderNote') || ''),
    sourceTimeZone: String(meta.get('sourceTimeZone') || 'Asia/Seoul'),
    issuedAt: String(meta.get('issuedAt') || new Date().toISOString().slice(0, 10)),
    hostParticipantId: String(meta.get('hostParticipantId') || ''),
    hostDisplayName: String(meta.get('hostDisplayName') || '주최자'),
    finalizedSlotId:
      typeof meta.get('finalizedSlotId') === 'string' && meta.get('finalizedSlotId')
        ? String(meta.get('finalizedSlotId'))
        : null,
    sharedNotes: notesText.toString(),
    events,
    proposedSlots,
    comments,
  };
}

/**
 * Applies minimal character-level diff to `Y.Text` so concurrent multi-user typing merges cleanly via YATA CRDT.
 */
export function applyCollaborativeNotesDiff(doc: Y.Doc, nextText: string): void {
  const yText = getSharedNotesText(doc);
  const prevText = yText.toString();
  if (prevText === nextText) return;

  let prefix = 0;
  const minLen = Math.min(prevText.length, nextText.length);
  while (prefix < minLen && prevText.charCodeAt(prefix) === nextText.charCodeAt(prefix)) {
    prefix += 1;
  }

  let prevSuffix = prevText.length;
  let nextSuffix = nextText.length;
  while (
    prevSuffix > prefix &&
    nextSuffix > prefix &&
    prevText.charCodeAt(prevSuffix - 1) === nextText.charCodeAt(nextSuffix - 1)
  ) {
    prevSuffix -= 1;
    nextSuffix -= 1;
  }

  const deleteCount = prevSuffix - prefix;
  const insertSlice = nextText.slice(prefix, nextSuffix);

  doc.transact(() => {
    if (deleteCount > 0) {
      yText.delete(prefix, deleteCount);
    }
    if (insertSlice.length > 0) {
      yText.insert(prefix, insertSlice);
    }
  }, YJS_LOCAL_ORIGIN);
}

export function updateWorkspaceMetaInDoc(
  doc: Y.Doc,
  patch: Partial<{ title: string; senderNote: string; theme: ShareCardTheme }>
): void {
  doc.transact(() => {
    const meta = getMetaMap(doc);
    if (patch.title !== undefined) {
      meta.set('title', patch.title);
      // 단일 일정 패스인 경우 대표 일정 제목도 동기화
      if (meta.get('kind') === 'event') {
        const eventsMap = getEventsMap(doc);
        const firstEntry = Array.from(eventsMap.values())[0];
        if (firstEntry instanceof Y.Map) {
          firstEntry.set('title', patch.title);
        }
      }
    }
    if (patch.senderNote !== undefined) meta.set('senderNote', patch.senderNote);
    if (patch.theme !== undefined) meta.set('theme', patch.theme);
  }, YJS_LOCAL_ORIGIN);
}

export function coEditSharedEventInDoc(
  doc: Y.Doc,
  eventId: string,
  patch: Partial<{
    title: string;
    date: string;
    startTime: string;
    endTime: string;
    isAllDay: boolean;
    category: CalendarCategory;
    location: string;
    content: string;
    isCompleted: boolean;
  }>,
  actorName: string
): void {
  doc.transact(() => {
    const eventsMap = getEventsMap(doc);
    const evMap = eventsMap.get(eventId);
    if (!(evMap instanceof Y.Map)) return;

    for (const [key, val] of Object.entries(patch)) {
      if (val !== undefined) {
        evMap.set(key, val);
      }
    }
    evMap.set('lastEditedBy', actorName);
    evMap.set('updatedAt', new Date().toISOString());

    const meta = getMetaMap(doc);
    if (meta.get('kind') === 'event' && patch.title !== undefined && eventsMap.size === 1) {
      meta.set('title', patch.title);
    }
  }, YJS_LOCAL_ORIGIN);
}

export function addSharedEventToDoc(
  doc: Y.Doc,
  draft: {
    title: string;
    date: string;
    startTime: string;
    endTime: string;
    timeZone: string;
    isAllDay: boolean;
    category: CalendarCategory;
    location?: string;
    content?: string;
  },
  actor: { participantId: string; displayName: string; colorHex: string; timeZone: string }
): string {
  const nowIso = new Date().toISOString();
  const newId = `cev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

  doc.transact(() => {
    const eventsMap = getEventsMap(doc);
    const evMap = new Y.Map<unknown>();
    eventsMap.set(newId, evMap);
    const { rsvpsMap } = populateIntegratedYEventMap(
      evMap,
      {
        id: newId,
        title: draft.title.trim() || '새 공동 일정',
        date: draft.date,
        startTime: draft.startTime,
        endTime: draft.endTime,
        timeZone: draft.timeZone,
        isAllDay: draft.isAllDay,
        category: draft.category,
        location: draft.location,
        content: draft.content,
      },
      actor.displayName,
      nowIso
    );

    rsvpsMap.set(actor.participantId, {
      participantId: actor.participantId,
      displayName: actor.displayName,
      colorHex: actor.colorHex,
      timeZone: actor.timeZone,
      status: 'attending',
      updatedAt: nowIso,
    });
  }, YJS_LOCAL_ORIGIN);

  return newId;
}

export function setEventRsvpInDoc(
  doc: Y.Doc,
  eventId: string,
  participant: {
    participantId: string;
    displayName: string;
    colorHex: string;
    timeZone: string;
  },
  status: SharePassRsvpStatus | null,
  note?: string
): void {
  doc.transact(() => {
    const eventsMap = getEventsMap(doc);
    const evMap = eventsMap.get(eventId);
    if (!(evMap instanceof Y.Map)) return;

    let rsvps = evMap.get('rsvps');
    if (!(rsvps instanceof Y.Map)) {
      rsvps = new Y.Map<CrdtEventRsvpEntry>();
      evMap.set('rsvps', rsvps);
    }

    const typedRsvps = rsvps as Y.Map<CrdtEventRsvpEntry>;
    if (status === null) {
      typedRsvps.delete(participant.participantId);
    } else {
      const prev = typedRsvps.get(participant.participantId);
      typedRsvps.set(participant.participantId, {
        participantId: participant.participantId,
        displayName: participant.displayName,
        colorHex: participant.colorHex,
        timeZone: participant.timeZone,
        status,
        note: note !== undefined ? note.trim().slice(0, 60) : prev?.note,
        updatedAt: new Date().toISOString(),
      });
    }
  }, YJS_LOCAL_ORIGIN);
}

export function toggleSharedChecklistInDoc(
  doc: Y.Doc,
  eventId: string,
  itemId: string,
  done: boolean,
  actorName: string
): void {
  doc.transact(() => {
    const evMap = getEventsMap(doc).get(eventId);
    if (!(evMap instanceof Y.Map)) return;
    const checklist = evMap.get('checklist');
    if (!(checklist instanceof Y.Map)) return;

    const existing = checklist.get(itemId) as CrdtChecklistEntry | undefined;
    if (!existing) return;

    checklist.set(itemId, {
      ...existing,
      done,
      updatedBy: actorName,
      updatedAt: new Date().toISOString(),
    });
  }, YJS_LOCAL_ORIGIN);
}

export function addSharedChecklistInDoc(
  doc: Y.Doc,
  eventId: string,
  text: string,
  actorName: string
): void {
  const clean = text.trim().slice(0, 140);
  if (!clean) return;

  doc.transact(() => {
    const evMap = getEventsMap(doc).get(eventId);
    if (!(evMap instanceof Y.Map)) return;
    let checklist = evMap.get('checklist');
    if (!(checklist instanceof Y.Map)) {
      checklist = new Y.Map<CrdtChecklistEntry>();
      evMap.set('checklist', checklist);
    }

    const itemId = `chk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
    (checklist as Y.Map<CrdtChecklistEntry>).set(itemId, {
      id: itemId,
      text: clean,
      done: false,
      updatedBy: actorName,
      updatedAt: new Date().toISOString(),
    });
  }, YJS_LOCAL_ORIGIN);
}

export function voteProposedSlotInDoc(
  doc: Y.Doc,
  slotId: string,
  participant: {
    participantId: string;
    displayName: string;
    colorHex: string;
    timeZone: string;
  },
  status: SharePassSlotVoteStatus | null
): void {
  doc.transact(() => {
    const slotMap = getSlotsMap(doc).get(slotId);
    if (!(slotMap instanceof Y.Map)) return;

    let votes = slotMap.get('votes');
    if (!(votes instanceof Y.Map)) {
      votes = new Y.Map<CrdtSlotVoteEntry>();
      slotMap.set('votes', votes);
    }

    const typedVotes = votes as Y.Map<CrdtSlotVoteEntry>;
    if (status === null) {
      typedVotes.delete(participant.participantId);
    } else {
      typedVotes.set(participant.participantId, {
        participantId: participant.participantId,
        displayName: participant.displayName,
        colorHex: participant.colorHex,
        timeZone: participant.timeZone,
        status,
        updatedAt: new Date().toISOString(),
      });
    }
  }, YJS_LOCAL_ORIGIN);
}

export function addProposedSlotInDoc(
  doc: Y.Doc,
  slot: {
    date: string;
    startTime: string;
    endTime: string;
    timeZone: string;
    label?: string;
  },
  actor: {
    participantId: string;
    displayName: string;
    colorHex: string;
    timeZone: string;
  }
): void {
  const nowIso = new Date().toISOString();
  const slotId = `slot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;

  doc.transact(() => {
    const slotsMap = getSlotsMap(doc);
    const slotMap = new Y.Map<unknown>();
    slotsMap.set(slotId, slotMap);
    slotMap.set('id', slotId);
    slotMap.set('date', slot.date);
    slotMap.set('startTime', slot.startTime);
    slotMap.set('endTime', slot.endTime);
    slotMap.set('timeZone', slot.timeZone);
    slotMap.set('label', slot.label?.trim() || '');
    slotMap.set('createdBy', actor.displayName);

    const votesMap = new Y.Map<CrdtSlotVoteEntry>();
    slotMap.set('votes', votesMap);
    votesMap.set(actor.participantId, {
      participantId: actor.participantId,
      displayName: actor.displayName,
      colorHex: actor.colorHex,
      timeZone: actor.timeZone,
      status: 'available',
      updatedAt: nowIso,
    });
  }, YJS_LOCAL_ORIGIN);
}

export function finalizeProposedSlotInDoc(
  doc: Y.Doc,
  slotId: string | null,
  actorName: string
): void {
  doc.transact(() => {
    const meta = getMetaMap(doc);
    meta.set('finalizedSlotId', slotId);

    if (!slotId) return;
    const slotMap = getSlotsMap(doc).get(slotId);
    if (!(slotMap instanceof Y.Map)) return;

    const eventsMap = getEventsMap(doc);
    const primaryEv = Array.from(eventsMap.values())[0];
    if (primaryEv instanceof Y.Map) {
      primaryEv.set('date', String(slotMap.get('date') || primaryEv.get('date')));
      primaryEv.set('startTime', String(slotMap.get('startTime') || primaryEv.get('startTime')));
      primaryEv.set('endTime', String(slotMap.get('endTime') || primaryEv.get('endTime')));
      primaryEv.set('timeZone', String(slotMap.get('timeZone') || primaryEv.get('timeZone')));
      primaryEv.set('isAllDay', false);
      primaryEv.set('lastEditedBy', actorName);
      primaryEv.set('updatedAt', new Date().toISOString());
    }
  }, YJS_LOCAL_ORIGIN);
}

export function appendWorkspaceCommentInDoc(
  doc: Y.Doc,
  targetId: string,
  body: string,
  author: {
    participantId: string;
    displayName: string;
    colorHex: string;
    timeZone: string;
  }
): void {
  const clean = body.trim().slice(0, 600);
  if (!clean) return;

  doc.transact(() => {
    const comments = getCommentsArray(doc);
    comments.push([
      {
        id: `cmt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        targetId: targetId || 'general',
        authorId: author.participantId,
        authorName: author.displayName,
        authorColor: author.colorHex,
        authorTimeZone: author.timeZone,
        body: clean,
        createdAt: new Date().toISOString(),
      },
    ]);
  }, YJS_LOCAL_ORIGIN);
}

/**
 * Converts the current co-edited CRDT view back into a standard `SharedPassPayload`
 * for high-resolution PNG card rendering, `.ics` export, or plain-text briefing copy.
 */
export function convertYDocWorkspaceToSharePayload(
  view: CollaborativeSharePassView
): SharedPassPayload {
  if (view.kind === 'event') {
    const primary = view.events[0];
    return {
      version: 1,
      kind: 'event',
      theme: view.theme,
      senderNote: view.senderNote || undefined,
      issuedAt: view.issuedAt,
      event: primary
        ? {
            id: primary.id,
            title: primary.title,
            date: primary.date,
            endDate: primary.endDate,
            startTime: primary.startTime,
            endTime: primary.endTime,
            timeZone: primary.timeZone,
            isAllDay: primary.isAllDay,
            category: primary.category,
            projectName: primary.projectName || view.subtitle,
            location: primary.location,
            locationAddress: primary.locationAddress,
            locationLat: primary.locationLat,
            locationLng: primary.locationLng,
            content: view.sharedNotes || primary.content,
            checklist: primary.checklist.map((c) => ({
              id: c.id,
              text: c.text,
              done: c.done,
            })),
            proposedSlots: view.proposedSlots.map((s) => ({
              date: s.date,
              startTime: s.startTime,
              endTime: s.endTime,
              label: s.label,
            })),
          }
        : undefined,
    };
  }

  return {
    version: 1,
    kind: 'project',
    theme: view.theme,
    senderNote: view.senderNote || undefined,
    issuedAt: view.issuedAt,
    project: {
      id: 'crdt-project',
      name: view.title,
      code: view.projectCode,
      clientOrOrg: view.clientOrOrg,
      description: view.sharedNotes || view.subtitle,
      startDate: view.startDate,
      endDate: view.endDate,
      events: view.events.map((ev) => ({
        id: ev.id,
        title: ev.title,
        date: ev.date,
        endDate: ev.endDate,
        startTime: ev.startTime,
        endTime: ev.endTime,
        timeZone: ev.timeZone,
        isAllDay: ev.isAllDay,
        category: ev.category,
        projectName: view.title,
        location: ev.location,
        locationAddress: ev.locationAddress,
        locationLat: ev.locationLat,
        locationLng: ev.locationLng,
        content: ev.content,
        checklist: ev.checklist.map((c) => ({
          id: c.id,
          text: c.text,
          done: c.done,
        })),
      })),
    },
  };
}
