import React, { useState, useRef, useEffect } from 'react';
import {
  Loader2,
  Volume2,
  VolumeX,
  RotateCcw,
  Calendar,
  Upload,
} from 'lucide-react';
import {
  AgentCommandResponse,
  AgentMessage,
  AiModelSelection,
  CalendarEventItem,
  FreeTimeSlot,
  GroundedDateSuggestion,
  RecommendedVenue,
  ChatSessionHistoryItem,
  ProjectItem,
  PromptAttachmentItem,
  MessageAttachmentSummary,
} from '../types';
import {
  DEFAULT_AI_MODEL_SELECTION,
  enrichLocationsBatch,
  fetchAgentHealth,
  sendAgentCommand,
} from '../services/agentApi';
import {
  CURATED_WEBLLM_MODELS,
  isWebGpuAvailable,
  WebLlmLoadProgress,
} from '../services/webllmProvider';
import {
  detectConflictAndSuggest,
  shouldUseSearchGroundingForPlanning,
} from '../shared/scheduleUtils';
import { isInternalOrVirtualLocation } from '../shared/locationUtils';
import {
  detectBrowserTimeZone,
  isValidTimeZone,
  mapEventsToViewerZone,
  toViewerProjectedEvent,
} from '../shared/timeZoneUtils';
import { useSpeechAgent } from '../hooks/useSpeechAgent';
import { CameraCaptureModal, CapturedPhoto } from './CameraCaptureModal';
import { PromptMarkdownInput, PromptMarkdownInputRef } from './PromptMarkdownInput';
import { MarkdownRenderer } from './MarkdownRenderer';
import { VoiceWaveformBar } from './chat/VoiceWaveformBar';
import { AgentResponseCards } from './chat/AgentResponseCards';
import {
  AttachmentKindIcon,
  AttachmentPreviewModal,
  DirectPasteSnippetModal,
} from './chat/AttachmentPreviewModal';
import {
  MAX_ATTACHMENTS,
  formatFileSize,
  processFilesForAttachment,
  createManualSnippetAttachment,
} from '../utils/attachmentProcessor';

interface AiChatSidebarProps {
  currentYear: number;
  selectedDate: string;
  viewerTimeZone?: string;
  existingEvents: CalendarEventItem[];
  selectedEvent: CalendarEventItem | null;
  onApplyResponse: (res: AgentCommandResponse) => void;
  onPatchEventsLocations?: (
    patches: Array<{
      id: string;
      location?: string;
      locationAddress?: string;
      locationLat?: number;
      locationLng?: number;
    }>
  ) => void;
  onCreateEventFromVenue: (venue: RecommendedVenue) => void;
  onAddGroundedSuggestion?: (item: GroundedDateSuggestion) => void;
  onJumpToDate?: (date: string) => void;
  onUpdateTimeSlot?: (eventId: string, startTime: string, endTime: string) => void;
  showToast: (msg: string) => void;
  projects?: ProjectItem[];
  selectedProjectId?: string | 'all';
  selectedProjectIds?: string[];
}

export const AiChatSidebar: React.FC<AiChatSidebarProps> = ({
  currentYear,
  selectedDate,
  viewerTimeZone,
  existingEvents,
  selectedEvent,
  onApplyResponse,
  onPatchEventsLocations,
  onCreateEventFromVenue,
  onAddGroundedSuggestion,
  onJumpToDate,
  onUpdateTimeSlot,
  showToast,
  projects = [],
  selectedProjectId = 'all',
  selectedProjectIds = [],
}) => {
  const effectiveViewerZone =
    viewerTimeZone && isValidTimeZone(viewerTimeZone)
      ? viewerTimeZone
      : detectBrowserTimeZone();
  const [messages, setMessages] = useState<AgentMessage[]>([
    {
      id: 'msg-welcome',
      role: 'assistant',
      content:
        '안녕하세요. 자연어 일정 지시와 초대장·식순·표·음성 첨부는 물론, 공휴일·업계 주요 일정과 겹치지 않는 최적 개최 후보일 추천이나 모임 장소 탐색도 이 대화창에서 바로 요청하실 수 있습니다.',
      timestamp: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
    },
  ]);

  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [addedVenueIds, setAddedVenueIds] = useState<Set<string>>(new Set());
  const [addedGroundedIds, setAddedGroundedIds] = useState<Set<string>>(new Set());
  const [lastReferencedEvent, setLastReferencedEvent] = useState<CalendarEventItem | null>(null);

  const [attachments, setAttachments] = useState<PromptAttachmentItem[]>([]);
  const [previewTarget, setPreviewTarget] = useState<
    PromptAttachmentItem | MessageAttachmentSummary | null
  >(null);
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
  const [isSnippetModalOpen, setIsSnippetModalOpen] = useState(false);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);

  const [modelSelection, setModelSelection] = useState<AiModelSelection>(() => {
    try {
      const saved = localStorage.getItem('vibe_ai_model_selection_v1');
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<AiModelSelection>;
        if (
          parsed &&
          (parsed.provider === 'cloud' ||
            parsed.provider === 'ollama' ||
            parsed.provider === 'webllm') &&
          typeof parsed.modelId === 'string' &&
          parsed.modelId &&
          typeof parsed.displayName === 'string' &&
          parsed.displayName
        ) {
          return {
            provider: parsed.provider,
            modelId: parsed.modelId,
            displayName: parsed.displayName,
            ollamaBaseUrl:
              typeof parsed.ollamaBaseUrl === 'string' && parsed.ollamaBaseUrl
                ? parsed.ollamaBaseUrl
                : DEFAULT_AI_MODEL_SELECTION.ollamaBaseUrl,
          };
        }
      }
    } catch {
      // ignore invalid storage
    }
    return DEFAULT_AI_MODEL_SELECTION;
  });
  const [webllmProgress, setWebllmProgress] = useState<WebLlmLoadProgress | null>(null);
  const [geminiEnabled, setGeminiEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    void fetchAgentHealth().then(({ geminiEnabled: enabled }) => {
      if (mounted) {
        setGeminiEnabled(enabled);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('vibe_ai_model_selection_v1', JSON.stringify(modelSelection));
    } catch {
      // ignore storage quota error
    }
  }, [modelSelection]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const promptInputRef = useRef<PromptMarkdownInputRef>(null);
  const dragDepthRef = useRef(0);

  const {
    isListening,
    isTtsEnabled,
    toggleTts,
    toggleVoiceInput,
    stopListening,
    speakText,
  } = useSpeechAgent({
    onTranscript: setPrompt,
    showToast,
  });

  useEffect(() => {
    if (selectedEvent) {
      setLastReferencedEvent(selectedEvent);
    }
  }, [selectedEvent]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleAddAttachments = (newItems: PromptAttachmentItem[]) => {
    setAttachments((prev) => {
      const remaining = Math.max(0, MAX_ATTACHMENTS - prev.length);
      return [...prev, ...newItems.slice(0, remaining)];
    });
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((item) => item.id !== id));
  };

  const handleClearAttachments = () => {
    setAttachments([]);
  };

  const handleExpandAttachmentToText = (
    item: PromptAttachmentItem | MessageAttachmentSummary
  ) => {
    if (!item.textContent) return;
    setPrompt((prev) => (prev.trim() ? `${prev}\n\n${item.textContent}` : item.textContent || ''));
    setAttachments((prev) => prev.filter((att) => att.id !== item.id));
    showToast('첨부 본문을 프롬프트 입력창에 펼쳤습니다.');
    setTimeout(() => promptInputRef.current?.focus(), 60);
  };

  const handleCameraCapture = (photo: CapturedPhoto) => {
    if (attachments.length >= MAX_ATTACHMENTS) {
      showToast(`첨부 파일은 최대 ${MAX_ATTACHMENTS}개까지 등록할 수 있습니다.`);
      return;
    }
    const approxBytes = Math.round((photo.base64.length * 3) / 4);
    const cameraItem: PromptAttachmentItem = {
      id: `cam-${Date.now()}`,
      name: photo.fileName,
      mimeType: photo.mimeType,
      sizeBytes: approxBytes,
      kind: 'image',
      transferMode: 'inline',
      base64Data: photo.base64,
      previewUrl: photo.dataUrl,
      metaLabel: `스캔 이미지 · ${formatFileSize(approxBytes)}`,
      source: 'camera',
    };
    handleAddAttachments([cameraItem]);
    setTimeout(() => promptInputRef.current?.focus(), 100);
  };

  const handleAttachManualSnippet = (title: string, content: string) => {
    if (attachments.length >= MAX_ATTACHMENTS) {
      showToast(`첨부 파일은 최대 ${MAX_ATTACHMENTS}개까지 등록할 수 있습니다.`);
      return;
    }
    const snippetItem = createManualSnippetAttachment(title, content);
    handleAddAttachments([snippetItem]);
    showToast(`'${snippetItem.name}' 스니펫이 첨부되었습니다.`);
    setTimeout(() => promptInputRef.current?.focus(), 80);
  };

  // 사이드바 전체 파일 드래그 앤 드롭 (캘린더 내부 이벤트 드래그와 구분)
  const hasExternalFiles = (e: React.DragEvent) =>
    Array.from(e.dataTransfer?.types || []).includes('Files');

  const handleDragEnter = (e: React.DragEvent) => {
    if (!hasExternalFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current += 1;
    if (dragDepthRef.current === 1) {
      setIsDraggingFiles(true);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!hasExternalFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!hasExternalFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDraggingFiles(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    if (!hasExternalFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setIsDraggingFiles(false);

    if (loading || !e.dataTransfer.files || e.dataTransfer.files.length === 0) return;

    const { added, errors } = await processFilesForAttachment(
      e.dataTransfer.files,
      attachments.length,
      'drop'
    );
    if (added.length > 0) {
      handleAddAttachments(added);
      showToast(
        added.length === 1
          ? `'${added[0].name}' 파일이 첨부되었습니다.`
          : `${added.length}개 파일이 첨부되었습니다.`
      );
      setTimeout(() => promptInputRef.current?.focus(), 80);
    }
    if (errors.length > 0) {
      showToast(errors[0]);
    }
  };

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend !== undefined ? textToSend : prompt).trim();
    if ((!text && attachments.length === 0) || loading) return;

    if (isListening) {
      stopListening();
    }

    const currentAttachments = [...attachments];
    const messageAttachments: MessageAttachmentSummary[] = currentAttachments.map((att) => ({
      id: att.id,
      name: att.name,
      kind: att.kind,
      mimeType: att.mimeType,
      sizeBytes: att.sizeBytes,
      metaLabel: att.metaLabel,
      previewUrl: att.previewUrl,
      textContent: att.textContent,
    }));

    const fallbackDisplayLabel =
      currentAttachments.length === 1
        ? `'${currentAttachments[0].name}' 파일의 일정을 분석하여 반영해 줘`
        : `첨부된 ${currentAttachments.length}개 자료의 일정을 분석하여 반영해 줘`;

    const userMsg: AgentMessage = {
      id: `msg-user-${Date.now()}`,
      role: 'user',
      content: text || fallbackDisplayLabel,
      timestamp: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
      attachments: messageAttachments.length > 0 ? messageAttachments : undefined,
      referencedEvent: lastReferencedEvent,
    };

    const historyPayload: ChatSessionHistoryItem[] = messages.slice(-10).map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
      actionType: m.response?.actionType,
      targetDate: m.response?.targetDate,
      targetEvent:
        m.referencedEvent ||
        m.response?.createdEvents?.[0] ||
        m.response?.queriedEvents?.[0] ||
        null,
      createdEvents: m.response?.createdEvents,
      updatedEvent: m.response?.updatedEvent,
      deletedEventId: m.response?.deletedEventId,
    }));

    setMessages((prev) => [...prev, userMsg]);
    setPrompt('');
    setAttachments([]);
    promptInputRef.current?.clear();
    setLoading(true);

    try {
      const apiAttachments = currentAttachments.map((att) => ({
        name: att.name,
        mimeType: att.mimeType,
        kind: att.kind,
        transferMode: att.transferMode,
        base64Data: att.base64Data,
        textContent: att.textContent,
      }));

      const res = await sendAgentCommand(
        text,
        {
          currentYear,
          selectedDate,
          viewerTimeZone: effectiveViewerZone,
          existingEvents,
          selectedEvent,
          chatHistory: historyPayload,
          lastReferencedEvent,
          projects,
          selectedProjectId,
          activeProjectName:
            selectedProjectIds.length >= 2
              ? `비교 중 (${selectedProjectIds.length}개): ${selectedProjectIds
                  .map((id) => projects.find((p) => p.id === id)?.name)
                  .filter(Boolean)
                  .join(', ')}`
              : selectedProjectId && selectedProjectId !== 'all'
              ? projects.find((p) => p.id === selectedProjectId)?.name
              : undefined,
        },
        undefined,
        apiAttachments.length > 0 ? apiAttachments : undefined,
        modelSelection,
        (prog) => setWebllmProgress(prog.percent >= 100 ? null : prog),
        {
          cloudAvailable: geminiEnabled !== false,
          onCloudGroundingRoute: () => {
            showToast('실시간 공휴일·웹 검색 검증을 위해 Cloud 검색 그라운딩으로 조회합니다.');
          },
        }
      );

      if (geminiEnabled === false && modelSelection.provider === 'cloud') {
        setGeminiEnabled(true);
      }

      const enhancedResponse: AgentCommandResponse = { ...res };
      if (res.createdEvents && res.createdEvents.length > 0) {
        const projectedPool = mapEventsToViewerZone(existingEvents, effectiveViewerZone);
        const aggregatedConflicts = new Map<
          string,
          { id: string; title: string; startTime: string; endTime: string }
        >();
        let firstConflictedEvent: CalendarEventItem | null = null;
        let firstSuggestedSlots: FreeTimeSlot[] = [];
        const conflictMessages: string[] = [];

        for (const created of res.createdEvents) {
          const projectedCreated = toViewerProjectedEvent(created, effectiveViewerZone);
          if (!created.isAllDay && created.startTime && created.endTime) {
            const conflict = detectConflictAndSuggest(
              projectedCreated.date,
              projectedCreated.startTime,
              projectedCreated.endTime,
              projectedPool,
              created.id
            );
            if (conflict.hasConflict) {
              if (!firstConflictedEvent) {
                firstConflictedEvent = created;
                firstSuggestedSlots = conflict.suggestedSlots;
              }
              for (const c of conflict.conflictingEvents) {
                aggregatedConflicts.set(c.id, {
                  id: c.id,
                  title: c.title,
                  startTime: c.startTime,
                  endTime: c.endTime,
                });
              }
              conflictMessages.push(
                res.createdEvents.length > 1
                  ? `'${created.title}': ${conflict.message}`
                  : conflict.message
              );
            }
          }
          projectedPool.push(projectedCreated);
        }

        if (firstConflictedEvent && aggregatedConflicts.size > 0) {
          enhancedResponse.conflictWarning = {
            hasConflict: true,
            targetEventId: firstConflictedEvent.id,
            targetEventTitle: firstConflictedEvent.title,
            conflictingEvents: Array.from(aggregatedConflicts.values()),
            suggestedSlots: firstSuggestedSlots,
            message: conflictMessages.join(' / '),
          };
        }
      }

      let currentActiveEvent: CalendarEventItem | null = lastReferencedEvent;

      if (enhancedResponse.createdEvents && enhancedResponse.createdEvents.length > 0) {
        currentActiveEvent = enhancedResponse.createdEvents[0];
        setLastReferencedEvent(currentActiveEvent);
      } else if (enhancedResponse.updatedEvent?.id) {
        const updatedId = enhancedResponse.updatedEvent.id;
        const found = existingEvents.find((e) => e.id === updatedId) || lastReferencedEvent;
        if (found) {
          const merged: CalendarEventItem = {
            ...found,
            ...enhancedResponse.updatedEvent.updates,
          };
          currentActiveEvent = merged;
          setLastReferencedEvent(merged);
        }
      } else if (enhancedResponse.deletedEventId) {
        if (lastReferencedEvent?.id === enhancedResponse.deletedEventId) {
          currentActiveEvent = null;
          setLastReferencedEvent(null);
        }
      } else if (enhancedResponse.queriedEvents && enhancedResponse.queriedEvents.length > 0) {
        currentActiveEvent = enhancedResponse.queriedEvents[0];
        setLastReferencedEvent(currentActiveEvent);
      }

      const assistantMsgId = `msg-ai-${Date.now()}`;
      const assistantMsg: AgentMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: enhancedResponse.replyText || '요청이 처리되었습니다.',
        timestamp: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
        response: enhancedResponse,
        referencedEvent: currentActiveEvent,
      };

      setMessages((prev) => [...prev, assistantMsg]);
      onApplyResponse(enhancedResponse);
      speakText(enhancedResponse.replyText);

      // 비동기 백그라운드 위치 주소·좌표 보강 (1차 응답 블로킹 제거)
      if (geminiEnabled !== false) {
        const batchTargets: Array<{ key: string; queryName: string }> = [];

        if (enhancedResponse.createdEvents) {
          for (const ev of enhancedResponse.createdEvents) {
            if (
              ev.location &&
              !isInternalOrVirtualLocation(ev.location) &&
              (!ev.locationAddress || ev.locationLat === undefined || ev.locationLng === undefined)
            ) {
              batchTargets.push({
                key: `created:${ev.id}`,
                queryName: [ev.location, ev.locationAddress].filter(Boolean).join(' '),
              });
            }
          }
        }

        if (
          enhancedResponse.updatedEvent?.id &&
          enhancedResponse.updatedEvent.updates?.location &&
          !isInternalOrVirtualLocation(enhancedResponse.updatedEvent.updates.location) &&
          (!enhancedResponse.updatedEvent.updates.locationAddress ||
            enhancedResponse.updatedEvent.updates.locationLat === undefined)
        ) {
          batchTargets.push({
            key: `updated:${enhancedResponse.updatedEvent.id}`,
            queryName: [
              enhancedResponse.updatedEvent.updates.location,
              enhancedResponse.updatedEvent.updates.locationAddress,
            ]
              .filter(Boolean)
              .join(' '),
          });
        }

        if (enhancedResponse.recommendedVenues) {
          for (const v of enhancedResponse.recommendedVenues) {
            if (
              v.name &&
              !isInternalOrVirtualLocation(v.name) &&
              (!v.address || v.lat === undefined || v.lng === undefined)
            ) {
              batchTargets.push({
                key: `venue:${v.id}`,
                queryName: [v.name, v.address].filter(Boolean).join(' '),
              });
            }
          }
        }

        if (batchTargets.length > 0) {
          void enrichLocationsBatch({
            items: batchTargets.slice(0, 8),
            modelId:
              modelSelection.provider === 'cloud'
                ? modelSelection.modelId
                : DEFAULT_AI_MODEL_SELECTION.modelId,
          }).then((batchRes) => {
            if (!batchRes.items.length && !batchRes.groundingSources.length) return;
            const byKey = new Map(batchRes.items.map((item) => [item.key, item]));

            const eventPatches: Array<{
              id: string;
              location?: string;
              locationAddress?: string;
              locationLat?: number;
              locationLng?: number;
            }> = [];

            for (const item of batchRes.items) {
              if (item.key.startsWith('created:') || item.key.startsWith('updated:')) {
                const eventId = item.key.replace(/^(?:created|updated):/, '');
                eventPatches.push({
                  id: eventId,
                  location: item.location,
                  locationAddress: item.locationAddress,
                  locationLat: item.locationLat,
                  locationLng: item.locationLng,
                });
              }
            }

            if (eventPatches.length > 0) {
              onPatchEventsLocations?.(eventPatches);
            }

            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantMsgId || !m.response) return m;
                const prevResp = m.response;
                const nextCreated = prevResp.createdEvents?.map((ev) => {
                  const found = byKey.get(`created:${ev.id}`);
                  if (!found) return ev;
                  return {
                    ...ev,
                    location: found.location || ev.location,
                    locationAddress: found.locationAddress || ev.locationAddress,
                    locationLat: found.locationLat ?? ev.locationLat,
                    locationLng: found.locationLng ?? ev.locationLng,
                  };
                });
                const updFound = prevResp.updatedEvent?.id
                  ? byKey.get(`updated:${prevResp.updatedEvent.id}`)
                  : undefined;
                const nextUpdated =
                  prevResp.updatedEvent && updFound
                    ? {
                        ...prevResp.updatedEvent,
                        updates: {
                          ...prevResp.updatedEvent.updates,
                          location: updFound.location || prevResp.updatedEvent.updates.location,
                          locationAddress:
                            updFound.locationAddress ||
                            prevResp.updatedEvent.updates.locationAddress,
                          locationLat:
                            updFound.locationLat ?? prevResp.updatedEvent.updates.locationLat,
                          locationLng:
                            updFound.locationLng ?? prevResp.updatedEvent.updates.locationLng,
                        },
                      }
                    : prevResp.updatedEvent;
                const nextVenues = prevResp.recommendedVenues?.map((v) => {
                  const found = byKey.get(`venue:${v.id}`);
                  if (!found) return v;
                  return {
                    ...v,
                    name: found.location || v.name,
                    address: found.locationAddress || v.address,
                    lat: found.locationLat ?? v.lat,
                    lng: found.locationLng ?? v.lng,
                  };
                });

                const existingSourceMap = new Map(
                  (prevResp.groundingSources || []).map((s) => [s.uri, s])
                );
                for (const src of batchRes.groundingSources) {
                  if (!existingSourceMap.has(src.uri)) {
                    existingSourceMap.set(src.uri, src);
                  }
                }
                const mergedSources = Array.from(existingSourceMap.values()).slice(0, 6);

                return {
                  ...m,
                  response: {
                    ...prevResp,
                    createdEvents: nextCreated,
                    updatedEvent: nextUpdated,
                    recommendedVenues: nextVenues,
                    groundingSources:
                      mergedSources.length > 0 ? mergedSources : prevResp.groundingSources,
                  },
                };
              })
            );
          });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '잠시 후 다시 시도해 주세요.';
      const errorMsg: AgentMessage = {
        id: `msg-err-${Date.now()}`,
        role: 'assistant',
        content: `오류가 발생했습니다: ${message}`,
        timestamp: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  const handleAddVenueToCalendar = (venue: RecommendedVenue) => {
    onCreateEventFromVenue(venue);
    setAddedVenueIds((prev) => new Set([...prev, venue.id]));
  };

  const handleAddGroundedToCalendar = (item: GroundedDateSuggestion) => {
    onAddGroundedSuggestion?.(item);
    setAddedGroundedIds((prev) => new Set([...prev, item.id]));
  };

  const comparedProjectLabel =
    selectedProjectIds.length >= 2
      ? selectedProjectIds
          .map((id) => projects.find((p) => p.id === id)?.name)
          .filter(Boolean)
          .join(', ')
      : '';

  const activeProject =
    selectedProjectId && selectedProjectId !== 'all'
      ? projects.find((p) => p.id === selectedProjectId)
      : undefined;

  const activeDiscoverySubject = comparedProjectLabel
    ? `${comparedProjectLabel} 비교 행사`
    : activeProject?.name || '';

  const handleTriggerDateDiscoveryFromComposer = () => {
    if (loading) return;

    const typed = prompt.trim();
    if (typed) {
      const nextQuery = shouldUseSearchGroundingForPlanning(typed)
        ? typed
        : `향후 3개월간 '${typed}' 기획 시 참고할 공휴일·업계 주요 일정과 최적 개최 후보일을 추천해 줘`;
      void handleSendMessage(nextQuery);
      return;
    }

    const draftPrompt = activeDiscoverySubject
      ? `향후 3개월간 '${activeDiscoverySubject}' 기획 시 참고할 공휴일·업계 주요 일정과 최적 개최 후보일을 추천해 줘`
      : '향후 3개월간 공휴일·업계 주요 일정과 겹치지 않는 신규 행사 개최 후보일을 추천해 줘';

    setPrompt(draftPrompt);
    setTimeout(() => promptInputRef.current?.focus(), 60);
  };

  const handleClearHistory = () => {
    setLastReferencedEvent(null);
    setAttachments([]);
    setAddedGroundedIds(new Set());
    setMessages([
      {
        id: `msg-welcome-${Date.now()}`,
        role: 'assistant',
        content:
          '새로운 대화 세션이 시작되었습니다. 자연어 일정 등록·수정, 문서·표·이미지·음성 첨부, 또는 공휴일·업계 일정을 고려한 개최 후보일 추천을 바로 요청해 보세요.',
        timestamp: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
    showToast('대화 기록 및 세션 문맥이 초기화되었습니다.');
  };

  const dynamicPlaceholder = isListening
    ? '음성을 듣고 있습니다...'
    : attachments.length > 0
    ? '첨부된 자료에 대한 요청사항을 입력하세요...'
    : '일정 등록, 장소 추천, 공휴일·업계 일정 탐색을 요청해 보세요...';

  return (
    <aside
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(e) => void handleDrop(e)}
      className="relative w-full h-full flex flex-col bg-[#12141a] border-r border-white/[0.08] select-none shrink-0 z-10"
    >
      {/* 파일 드래그 앤 드롭 오버레이 */}
      {isDraggingFiles && (
        <div className="absolute inset-0 z-40 bg-[#0b0d13]/85 backdrop-blur-xs p-4 flex items-center justify-center pointer-events-none">
          <div className="w-full h-full rounded-2xl border border-dashed border-white/25 bg-white/[0.02] flex flex-col items-center justify-center text-center px-6 gap-2.5">
            <div className="w-11 h-11 rounded-2xl bg-white/[0.06] border border-white/[0.1] flex items-center justify-center text-white">
              <Upload className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold text-white">파일을 놓아 컨시어지에 첨부</p>
              <p className="text-[11px] text-neutral-400">
                이미지 · PDF · 워드(DOCX) · 표(CSV/TSV) · 일정(ICS) · 문서 · 오디오
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 1. 상단 서브 헤더 (우측 캘린더 요일 헤더 h-10 과 1:1 수평 일치) */}
      <div className="h-10 px-4 border-b border-white/[0.05] flex items-center justify-between bg-[#101218] shrink-0">
        <h2 className="text-xs font-medium text-neutral-300 tracking-tight whitespace-nowrap shrink-0">
          일정 컨시어지
        </h2>

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={toggleTts}
            className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors duration-150 cursor-pointer shrink-0 ${
              isTtsEnabled
                ? 'text-neutral-300 hover:text-white hover:bg-white/[0.05]'
                : 'text-neutral-600 hover:text-neutral-300 hover:bg-white/[0.05]'
            }`}
            title={isTtsEnabled ? '음성 안내 끄기' : '음성 안내 켜기'}
          >
            {isTtsEnabled ? (
              <Volume2 className="w-3.5 h-3.5" strokeWidth={1.65} />
            ) : (
              <VolumeX className="w-3.5 h-3.5" strokeWidth={1.65} />
            )}
          </button>

          <button
            type="button"
            onClick={handleClearHistory}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-neutral-500 hover:text-neutral-200 hover:bg-white/[0.05] transition-colors duration-150 cursor-pointer shrink-0"
            title="대화 세션 초기화"
          >
            <RotateCcw className="w-3.5 h-3.5" strokeWidth={1.65} />
          </button>
        </div>
      </div>

      {/* 1-1. Cloud API 키 미연결 시 절제된 인라인 안내 바 */}
      {geminiEnabled === false && modelSelection.provider === 'cloud' && (
        <div className="px-4 py-2 bg-[#141720] border-b border-amber-500/20 flex items-center justify-between gap-2 text-[11px] shrink-0">
          <p className="text-neutral-300 leading-snug min-w-0">
            <span className="text-amber-300 font-medium">Cloud 키 미설정</span>
            <span aria-hidden="true" className="text-neutral-600 mx-1.5">·</span>
            <span className="text-neutral-400">
              Settings &gt; Secrets에 GEMINI_API_KEY 등록 또는 로컬 모델 이용
            </span>
          </p>
          {isWebGpuAvailable() && CURATED_WEBLLM_MODELS[0] && (
            <button
              type="button"
              onClick={() => {
                const target = CURATED_WEBLLM_MODELS[0];
                setModelSelection({
                  provider: 'webllm',
                  modelId: target.id,
                  displayName: target.label,
                  ollamaBaseUrl: modelSelection.ollamaBaseUrl,
                });
                showToast(`브라우저 온디바이스 모델(${target.label})로 전환했습니다.`);
              }}
              className="h-6 px-2 rounded-md bg-white/[0.08] hover:bg-white/[0.14] text-[10.5px] font-medium text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              WebLLM 전환
            </button>
          )}
        </div>
      )}

      {/* 1-2. 조건부 참조 문맥 바 (일정 선택 시에만 무채색 인라인 노출) */}
      {lastReferencedEvent && (
        <div className="h-8 px-4 bg-[#13161f] border-b border-white/[0.05] flex items-center justify-between text-[11px] shrink-0 gap-2">
          <div className="flex items-center gap-1.5 min-w-0 text-neutral-400">
            <span className="text-neutral-500 shrink-0">참조</span>
            <span aria-hidden="true" className="text-neutral-600">·</span>
            <span
              className="text-neutral-200 truncate"
              title={`${lastReferencedEvent.title} (${lastReferencedEvent.date} ${lastReferencedEvent.startTime}~${lastReferencedEvent.endTime})`}
            >
              {lastReferencedEvent.title}
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => void handleSendMessage('방금 말한 그 일정 30분 뒤로 미뤄줘')}
              className="text-[10px] px-1.5 py-0.5 rounded text-neutral-400 hover:text-white hover:bg-white/[0.07] transition-colors cursor-pointer tabular-nums whitespace-nowrap shrink-0"
            >
              +30분
            </button>
            <button
              type="button"
              onClick={() => void handleSendMessage('방금 말한 그 일정 1시간 뒤로 미뤄줘')}
              className="text-[10px] px-1.5 py-0.5 rounded text-neutral-400 hover:text-white hover:bg-white/[0.07] transition-colors cursor-pointer tabular-nums whitespace-nowrap shrink-0"
            >
              +1시간
            </button>
            <button
              type="button"
              onClick={() => void handleSendMessage('방금 말한 그 일정 삭제해줘')}
              className="text-[10px] px-1.5 py-0.5 rounded text-neutral-400 hover:text-rose-300 hover:bg-rose-500/10 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              삭제
            </button>
          </div>
        </div>
      )}

      {/* 2. 메시지 목록 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 select-text">
        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          const imageAttachments =
            msg.attachments?.filter((a) => a.kind === 'image' && a.previewUrl) || [];
          const fileAttachments =
            msg.attachments?.filter((a) => !(a.kind === 'image' && a.previewUrl)) || [];

          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} space-y-1.5`}
            >
              <div
                className={`max-w-[90%] p-3.5 rounded-2xl text-xs leading-relaxed ${
                  isUser
                    ? 'bg-[#222634] text-neutral-100 border border-white/[0.1] rounded-br-none'
                    : 'bg-[#181b24] text-neutral-200 border border-white/[0.07] rounded-bl-none'
                }`}
              >
                {isUser && msg.referencedEvent && (
                  <div className="flex items-center gap-1.5 text-[10px] text-neutral-400 mb-2 pb-1.5 border-b border-white/[0.07]">
                    <Calendar className="w-3 h-3 text-neutral-400 shrink-0" />
                    <span className="truncate">참조 일정 · {msg.referencedEvent.title}</span>
                  </div>
                )}

                {/* 구버전 단일 이미지 호환 */}
                {msg.imageUrl && imageAttachments.length === 0 && (
                  <div className="mb-2.5 rounded-xl overflow-hidden border border-white/10 max-w-xs">
                    <img
                      src={msg.imageUrl}
                      alt="첨부된 사진"
                      referrerPolicy="no-referrer"
                      className="w-full max-h-56 object-cover"
                    />
                  </div>
                )}

                {/* 멀티모달 이미지 썸네일 그리드 */}
                {imageAttachments.length > 0 && (
                  <div
                    className={`mb-2.5 grid gap-1.5 ${
                      imageAttachments.length > 1 ? 'grid-cols-2' : 'grid-cols-1'
                    }`}
                  >
                    {imageAttachments.map((imgAtt) => (
                      <button
                        key={imgAtt.id}
                        type="button"
                        onClick={() => setPreviewTarget(imgAtt)}
                        className="rounded-xl overflow-hidden border border-white/10 hover:border-white/25 transition-colors cursor-pointer text-left"
                        title={`${imgAtt.name} 크게 보기`}
                      >
                        <img
                          src={imgAtt.previewUrl}
                          alt={imgAtt.name}
                          referrerPolicy="no-referrer"
                          className="w-full max-h-48 object-cover"
                        />
                      </button>
                    ))}
                  </div>
                )}

                {/* 문서 / 표 / ICS / 오디오 / 클립보드 첨부 목록 */}
                {fileAttachments.length > 0 && (
                  <div className="mb-2.5 space-y-1">
                    {fileAttachments.map((att) => (
                      <button
                        key={att.id}
                        type="button"
                        onClick={() => setPreviewTarget(att)}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-black/25 hover:bg-black/40 border border-white/[0.07] transition-colors cursor-pointer text-left"
                        title="클릭하여 첨부 내용 보기"
                      >
                        <AttachmentKindIcon
                          kind={att.kind}
                          className="w-3.5 h-3.5 text-neutral-300 shrink-0"
                        />
                        <span className="text-[11px] font-medium text-neutral-100 truncate flex-1">
                          {att.name}
                        </span>
                        <span className="text-[10px] text-neutral-400 tabular-nums shrink-0">
                          {att.metaLabel || formatFileSize(att.sizeBytes)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                <MarkdownRenderer content={msg.content} />
              </div>

              <span className="text-[10px] text-neutral-500 px-1 font-mono tabular-nums">
                {msg.timestamp}
              </span>

              {!isUser && msg.response && (
                <AgentResponseCards
                  response={msg.response}
                  selectedDate={selectedDate}
                  viewerTimeZone={effectiveViewerZone}
                  addedVenueIds={addedVenueIds}
                  addedGroundedIds={addedGroundedIds}
                  onAddVenueToCalendar={handleAddVenueToCalendar}
                  onAddGroundedSuggestion={handleAddGroundedToCalendar}
                  onJumpToDate={onJumpToDate}
                  onSendMessage={(p) => void handleSendMessage(p)}
                  onUpdateTimeSlot={onUpdateTimeSlot}
                />
              )}
            </div>
          );
        })}

        {messages.length === 1 && !loading && (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            <button
              type="button"
              onClick={() =>
                void handleSendMessage(
                  activeDiscoverySubject
                    ? `향후 3개월간 '${activeDiscoverySubject}' 기획 시 참고할 공휴일·업계 주요 일정과 최적 개최 후보일을 추천해 줘`
                    : '향후 3개월간 공휴일·업계 주요 일정과 겹치지 않는 행사 개최 후보일을 추천해 줘'
                )
              }
              className="px-2.5 py-1 rounded-lg bg-[#161922] hover:bg-[#1c202c] border border-white/[0.07] hover:border-white/[0.15] text-[11px] text-neutral-300 hover:text-white transition-colors cursor-pointer whitespace-nowrap"
            >
              공휴일·업계 일정 피해서 개최일 추천
            </button>
            <button
              type="button"
              onClick={() => void handleSendMessage('오늘 일정 브리핑과 여유 시간대를 알려줘')}
              className="px-2.5 py-1 rounded-lg bg-[#161922] hover:bg-[#1c202c] border border-white/[0.07] hover:border-white/[0.15] text-[11px] text-neutral-300 hover:text-white transition-colors cursor-pointer whitespace-nowrap"
            >
              오늘 일정 및 여유 시간 확인
            </button>
          </div>
        )}

        {loading && (
          <div className="flex items-start">
            <div className="p-3 rounded-2xl bg-[#181b24] border border-white/[0.08] text-xs text-neutral-300 flex items-center gap-2">
              <Loader2 className="w-4 h-4 text-neutral-200 animate-spin" />
              <span>첨부 컨텍스트와 일정을 정밀 분석하고 있습니다...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 3. 실시간 음성 파형 바 */}
      {isListening && (
        <VoiceWaveformBar
          prompt={prompt}
          onSendNow={() => void handleSendMessage()}
          onCancel={toggleVoiceInput}
        />
      )}

      {/* 4. 하단 럭셔리 미니멀리즘 멀티모달 프롬프트 독 */}
      <div className="p-3 bg-[#12141a] border-t border-white/[0.06] shrink-0">
        <PromptMarkdownInput
          ref={promptInputRef}
          disabled={loading}
          loading={loading}
          placeholder={dynamicPlaceholder}
          onSend={(text) => void handleSendMessage(text)}
          onTextChange={setPrompt}
          externalText={prompt}
          attachments={attachments}
          onAddAttachments={handleAddAttachments}
          onRemoveAttachment={handleRemoveAttachment}
          onClearAttachments={handleClearAttachments}
          onPreviewAttachment={(item) => setPreviewTarget(item)}
          onExpandAttachmentToText={handleExpandAttachmentToText}
          onOpenCamera={() => setIsCameraModalOpen(true)}
          onOpenSnippetModal={() => setIsSnippetModalOpen(true)}
          onOpenDateDiscovery={handleTriggerDateDiscoveryFromComposer}
          isListening={isListening}
          onToggleVoice={toggleVoiceInput}
          modelSelection={modelSelection}
          onChangeModelSelection={setModelSelection}
          webllmProgress={webllmProgress}
          onWebLlmProgress={setWebllmProgress}
          showToast={showToast}
        />
      </div>

      {/* 카메라 문서/명함 촬영 모달 */}
      <CameraCaptureModal
        isOpen={isCameraModalOpen}
        onClose={() => setIsCameraModalOpen(false)}
        onCapture={handleCameraCapture}
        showToast={showToast}
      />

      {/* 첨부 파일 상세 미리보기 모달 */}
      <AttachmentPreviewModal
        attachment={previewTarget}
        onClose={() => setPreviewTarget(null)}
        onExpandToPrompt={handleExpandAttachmentToText}
      />

      {/* 직접 텍스트 · 표 스니펫 붙여넣기 모달 */}
      <DirectPasteSnippetModal
        isOpen={isSnippetModalOpen}
        onClose={() => setIsSnippetModalOpen(false)}
        onAttachSnippet={handleAttachManualSnippet}
      />
    </aside>
  );
};
