export type CalendarCategory =
  | '업무'
  | '방문·출장'
  | '식사·모임'
  | '개인'
  | '행사·세미나'
  | '기타';

export type ProjectStatus = 'active' | 'planning' | 'on_hold' | 'completed';

export interface ProjectItem {
  id: string;
  name: string;
  code?: string;
  description?: string;
  color: string;
  status: ProjectStatus;
  startDate?: string;
  endDate?: string;
  clientOrOrg?: string;
  createdAt: string;
  isSample?: boolean;
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface CalendarEventItem {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  endDate?: string;
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  timeZone?: string; // IANA 타임존 (예: 'Asia/Seoul', 'Asia/Jakarta' 등. 생략 시 사용자 현재 위치 기준)
  isAllDay: boolean;
  category: CalendarCategory;
  projectId?: string;
  location?: string;
  locationAddress?: string;
  locationLat?: number;
  locationLng?: number;
  content?: string;
  isCompleted?: boolean;
  checklist?: ChecklistItem[];
  isSample?: boolean;
}

export interface RecommendedVenue {
  id: string;
  name: string;
  category: string;
  address: string;
  lat?: number;
  lng?: number;
  capacityInfo: string;
  priceRange?: string;
  features?: string[];
  reason: string;
  recommendedDishes?: string;
  contact?: string;
  targetDate?: string;
}

export interface ThoughtStep {
  step: number;
  title: string;
  status: 'pending' | 'in_progress' | 'completed';
  details?: string;
}

export interface ThoughtTrace {
  summary: string;
  intent?: string;
  steps?: ThoughtStep[];
}

export type AgentActionType =
  | 'QUERY_EVENTS'
  | 'CREATE_EVENT'
  | 'RECOMMEND_VENUE'
  | 'SUGGEST_DATES'
  | 'UPDATE_EVENT'
  | 'DELETE_EVENT'
  | 'GENERAL_CHAT';

export type GroundedSuggestionKind = 'holiday' | 'industry_event' | 'recommended_date';

export interface GroundedDateSuggestion {
  id: string;
  date: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  title: string;
  kind: GroundedSuggestionKind;
  advisory?: string;
  description: string;
  location?: string;
  locationAddress?: string;
  locationLat?: number;
  locationLng?: number;
}

export interface GroundingWebSource {
  uri: string;
  title: string;
}

export interface FreeTimeSlot {
  startTime: string;
  endTime: string;
  durationMinutes?: number;
  label?: string;
}

export interface AgentCommandResponse {
  success: boolean;
  actionType: AgentActionType;
  replyText: string;
  targetDate?: string | null;
  thoughtTrace?: ThoughtTrace | null;
  queriedEvents?: CalendarEventItem[];
  freeTimeSlots?: FreeTimeSlot[];
  createdEvents?: CalendarEventItem[];
  recommendedVenues?: RecommendedVenue[];
  groundedSuggestions?: GroundedDateSuggestion[];
  groundingSources?: GroundingWebSource[];
  searchQueries?: string[];
  updatedEvent?: {
    id: string;
    targetTitle: string;
    updates: Partial<CalendarEventItem>;
    diffSummary: string;
  } | null;
  deletedEventId?: string | null;
  suggestedPrompts?: string[];
  conflictWarning?: {
    hasConflict: boolean;
    conflictingEvents: Array<{ id: string; title: string; startTime: string; endTime: string }>;
    suggestedSlots: FreeTimeSlot[];
    message: string;
  } | null;
}

export interface ChatSessionHistoryItem {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  actionType?: AgentActionType;
  targetDate?: string | null;
  targetEvent?: CalendarEventItem | null;
  createdEvents?: CalendarEventItem[];
  updatedEvent?: AgentCommandResponse['updatedEvent'];
  deletedEventId?: string | null;
}

export type PromptAttachmentKind =
  | 'image'
  | 'pdf'
  | 'audio'
  | 'spreadsheet'
  | 'calendar'
  | 'document'
  | 'clipboard';

export interface PromptAttachmentItem {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  kind: PromptAttachmentKind;
  transferMode: 'inline' | 'text';
  base64Data?: string;
  previewUrl?: string;
  textContent?: string;
  metaLabel?: string;
  source?: 'file' | 'paste' | 'drop' | 'camera';
}

export interface MessageAttachmentSummary {
  id: string;
  name: string;
  kind: PromptAttachmentKind;
  mimeType: string;
  sizeBytes: number;
  metaLabel?: string;
  previewUrl?: string;
  textContent?: string;
}

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  response?: AgentCommandResponse;
  imageUrl?: string;
  attachments?: MessageAttachmentSummary[];
  referencedEvent?: CalendarEventItem | null;
}

export type AiProviderType = 'cloud' | 'ollama' | 'webllm';

export interface AiModelSelection {
  provider: AiProviderType;
  modelId: string;
  displayName: string;
  ollamaBaseUrl: string;
}


