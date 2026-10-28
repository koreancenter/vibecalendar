import { PromptAttachmentItem, PromptAttachmentKind } from '../types';

export const MAX_ATTACHMENTS = 5;
const MAX_INLINE_FILE_BYTES = 8 * 1024 * 1024; // 8MB (PDF / Audio)
const MAX_RAW_IMAGE_BYTES = 20 * 1024 * 1024; // 20MB (자동 리사이즈/최적화 전 원본 허용치)
const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024; // 2MB 텍스트 계열
const MAX_EXTRACTED_TEXT_CHARS = 36_000;

export const UNIVERSAL_FILE_ACCEPT =
  'image/jpeg,image/png,image/webp,image/gif,application/pdf,.pdf,.ics,text/calendar,.csv,.tsv,text/csv,text/tab-separated-values,.txt,.md,.markdown,.json,.html,.htm,.xml,.yaml,.yml,.eml,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,audio/mpeg,audio/mp3,audio/wav,audio/webm,audio/ogg,audio/mp4,audio/x-m4a,.mp3,.wav,.m4a,.webm,.ogg';

export const DOCUMENT_FILE_ACCEPT =
  'application/pdf,.pdf,.ics,text/calendar,.csv,.tsv,text/csv,text/tab-separated-values,.txt,.md,.markdown,.json,.html,.htm,.xml,.yaml,.yml,.eml,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export const IMAGE_FILE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';

export const AUDIO_FILE_ACCEPT =
  'audio/mpeg,audio/mp3,audio/wav,audio/webm,audio/ogg,audio/mp4,audio/x-m4a,.mp3,.wav,.m4a,.webm,.ogg';

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function getFileExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : '';
}

function makeAttachmentId(prefix = 'att'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('파일을 읽는 중 오류가 발생했습니다.'));
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('텍스트 파일을 읽는 중 오류가 발생했습니다.'));
    reader.readAsText(file, 'utf-8');
  });
}

async function optimizeImageBlob(
  file: File,
  source: PromptAttachmentItem['source']
): Promise<PromptAttachmentItem> {
  if (file.size > MAX_RAW_IMAGE_BYTES) {
    throw new Error(`'${file.name}' 이미지 용량이 너무 큽니다 (최대 20MB).`);
  }

  const rawDataUrl = await readFileAsDataUrl(file);

  // GIF 소용량 파일은 원본 유지
  if (file.type === 'image/gif' && file.size <= 3 * 1024 * 1024) {
    const base64Data = rawDataUrl.split(',')[1] || '';
    return {
      id: makeAttachmentId('img'),
      name: file.name || '이미지.gif',
      mimeType: 'image/gif',
      sizeBytes: file.size,
      kind: 'image',
      transferMode: 'inline',
      base64Data,
      previewUrl: rawDataUrl,
      metaLabel: `GIF · ${formatFileSize(file.size)}`,
      source,
    };
  }

  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => {
      const maxDim = 1600;
      let w = img.width || 1200;
      let h = img.height || 900;

      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('이미지 최적화 컨텍스트를 생성할 수 없습니다.'));
        return;
      }

      // 투명 배경 보존을 위해 PNG 소용량 스크린샷은 PNG 유지, 대용량은 고화질 WEBP/JPEG 변환
      const keepPng = file.type === 'image/png' && file.size <= 1.4 * 1024 * 1024 && w <= 1600 && h <= 1600;
      const targetMime = keepPng ? 'image/png' : 'image/jpeg';

      if (!keepPng) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
      }
      ctx.drawImage(img, 0, 0, w, h);

      const optimizedDataUrl = keepPng
        ? canvas.toDataURL('image/png')
        : canvas.toDataURL('image/jpeg', 0.89);

      const base64Data = optimizedDataUrl.split(',')[1] || '';
      const approxBytes = Math.round((base64Data.length * 3) / 4);

      const timeTag = new Date().toTimeString().slice(0, 5).replace(':', '');
      const cleanName =
        !file.name || file.name === 'image.png' || file.name === 'blob'
          ? `클립보드_캡처_${timeTag}.${keepPng ? 'png' : 'jpg'}`
          : file.name;

      resolve({
        id: makeAttachmentId('img'),
        name: cleanName,
        mimeType: targetMime,
        sizeBytes: approxBytes,
        kind: 'image',
        transferMode: 'inline',
        base64Data,
        previewUrl: optimizedDataUrl,
        metaLabel: `${source === 'paste' ? '캡처 이미지' : '이미지'} · ${formatFileSize(approxBytes)}`,
        source,
      });
    };
    img.onerror = () => reject(new Error(`'${file.name}' 이미지를 디코딩할 수 없습니다.`));
    img.src = rawDataUrl;
  });
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * 외부 라이브러리 없이 브라우저 내장 DecompressionStream으로 DOCX(ZIP 내 word/document.xml) 본문 추출
 */
async function extractDocxText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  // End of Central Directory (0x06054b50) 역방향 탐색
  let eocdOffset = -1;
  const minSearch = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= minSearch; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error('유효한 DOCX 문서 구조가 아닙니다.');
  }

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);
  let ptr = cdOffset;
  const decoder = new TextDecoder('utf-8');

  for (let idx = 0; idx < totalEntries && ptr + 46 <= bytes.length; idx++) {
    if (view.getUint32(ptr, true) !== 0x02014b50) break;
    const compressionMethod = view.getUint16(ptr + 10, true);
    const compressedSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localHeaderOffset = view.getUint32(ptr + 42, true);

    const entryName = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
    ptr += 46 + nameLen + extraLen + commentLen;

    if (entryName === 'word/document.xml') {
      if (localHeaderOffset + 30 > bytes.length) break;
      const localNameLen = view.getUint16(localHeaderOffset + 26, true);
      const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
      const compressedSlice = bytes.subarray(dataStart, dataStart + compressedSize);

      let xmlText = '';
      if (compressionMethod === 0) {
        xmlText = decoder.decode(compressedSlice);
      } else if (compressionMethod === 8 && typeof DecompressionStream !== 'undefined') {
        const ds = new DecompressionStream('deflate-raw');
        const stream = new Blob([compressedSlice]).stream().pipeThrough(ds);
        const decompressedBuf = await new Response(stream).arrayBuffer();
        xmlText = decoder.decode(decompressedBuf);
      } else {
        throw new Error('현재 브라우저에서 DOCX 압축 해제를 지원하지 않습니다. PDF 또는 TXT로 첨부해 주세요.');
      }

      const formatted = xmlText
        .replace(/<\/w:tc>/g, '\t')
        .replace(/<\/w:tr>/g, '\n')
        .replace(/<\/w:p>/g, '\n')
        .replace(/<w:br[^>]*\/?>/g, '\n')
        .replace(/<w:tab[^>]*\/?>/g, '\t')
        .replace(/<[^>]+>/g, '');

      return decodeXmlEntities(formatted)
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }
  }

  throw new Error('DOCX 문서에서 텍스트 본문을 찾을 수 없습니다.');
}

function normalizeAudioMimeType(mime: string, ext: string): string {
  const lower = mime.toLowerCase();
  if (lower === 'audio/mpeg' || lower === 'audio/mp3' || ext === 'mp3') return 'audio/mp3';
  if (lower === 'audio/wav' || lower === 'audio/x-wav' || ext === 'wav') return 'audio/wav';
  if (lower === 'audio/webm' || ext === 'webm') return 'audio/webm';
  if (lower === 'audio/ogg' || ext === 'ogg') return 'audio/ogg';
  if (lower === 'audio/mp4' || lower === 'audio/x-m4a' || lower === 'audio/aac' || ext === 'm4a') {
    return 'audio/mp4';
  }
  return 'audio/mp3';
}

export async function processSingleFile(
  file: File,
  source: PromptAttachmentItem['source'] = 'file'
): Promise<PromptAttachmentItem> {
  const ext = getFileExtension(file.name);
  const mime = (file.type || '').toLowerCase();

  // 1. 이미지 파일
  if (
    mime.startsWith('image/') &&
    (['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mime) ||
      ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext))
  ) {
    return optimizeImageBlob(file, source);
  }
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) {
    return optimizeImageBlob(file, source);
  }

  // 2. PDF 문서 (Gemini 멀티모달 직접 분석)
  if (mime === 'application/pdf' || ext === 'pdf') {
    if (file.size > MAX_INLINE_FILE_BYTES) {
      throw new Error(`'${file.name}' 용량이 8MB 제한을 초과했습니다.`);
    }
    const dataUrl = await readFileAsDataUrl(file);
    const base64Data = dataUrl.split(',')[1] || '';
    return {
      id: makeAttachmentId('pdf'),
      name: file.name,
      mimeType: 'application/pdf',
      sizeBytes: file.size,
      kind: 'pdf',
      transferMode: 'inline',
      base64Data,
      metaLabel: `PDF · ${formatFileSize(file.size)}`,
      source,
    };
  }

  // 3. 오디오 / 음성 녹음 파일 (회의 녹음, 보이스 메모)
  if (
    mime.startsWith('audio/') ||
    ['mp3', 'wav', 'm4a', 'webm', 'ogg'].includes(ext)
  ) {
    if (file.size > MAX_INLINE_FILE_BYTES) {
      throw new Error(`'${file.name}' 오디오 용량이 8MB 제한을 초과했습니다.`);
    }
    const normalizedMime = normalizeAudioMimeType(mime, ext);
    const dataUrl = await readFileAsDataUrl(file);
    const base64Data = dataUrl.split(',')[1] || '';
    return {
      id: makeAttachmentId('aud'),
      name: file.name,
      mimeType: normalizedMime,
      sizeBytes: file.size,
      kind: 'audio',
      transferMode: 'inline',
      base64Data,
      previewUrl: dataUrl,
      metaLabel: `오디오 · ${formatFileSize(file.size)}`,
      source,
    };
  }

  // 4. DOCX 워드 문서 (브라우저 네이티브 XML 텍스트 추출)
  if (
    ext === 'docx' ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    if (file.size > MAX_INLINE_FILE_BYTES) {
      throw new Error(`'${file.name}' 문서 용량이 너무 큽니다.`);
    }
    const extracted = await extractDocxText(file);
    if (!extracted) {
      throw new Error(`'${file.name}' 문서에 추출 가능한 텍스트가 없습니다.`);
    }
    const sliced = extracted.slice(0, MAX_EXTRACTED_TEXT_CHARS);
    return {
      id: makeAttachmentId('docx'),
      name: file.name,
      mimeType: 'text/plain',
      sizeBytes: file.size,
      kind: 'document',
      transferMode: 'text',
      textContent: sliced,
      metaLabel: `DOCX · ${sliced.length.toLocaleString()}자`,
      source,
    };
  }

  // 5. ICS 캘린더 파일
  if (ext === 'ics' || mime === 'text/calendar') {
    if (file.size > MAX_TEXT_FILE_BYTES) {
      throw new Error(`'${file.name}' 파일이 너무 큽니다 (최대 2MB).`);
    }
    const rawText = await readFileAsText(file);
    const eventCount = (rawText.match(/BEGIN:VEVENT/gi) || []).length;
    const sliced = rawText.slice(0, MAX_EXTRACTED_TEXT_CHARS);
    return {
      id: makeAttachmentId('ics'),
      name: file.name,
      mimeType: 'text/calendar',
      sizeBytes: file.size,
      kind: 'calendar',
      transferMode: 'text',
      textContent: sliced,
      metaLabel:
        eventCount > 0
          ? `ICS · ${eventCount}건 일정 · ${formatFileSize(file.size)}`
          : `ICS · ${formatFileSize(file.size)}`,
      source,
    };
  }

  // 6. CSV / TSV 스프레드시트 데이터
  if (
    ext === 'csv' ||
    ext === 'tsv' ||
    mime === 'text/csv' ||
    mime === 'text/tab-separated-values' ||
    (mime === 'application/vnd.ms-excel' && ext === 'csv')
  ) {
    if (file.size > MAX_TEXT_FILE_BYTES) {
      throw new Error(`'${file.name}' 표 파일이 너무 큽니다 (최대 2MB).`);
    }
    const rawText = await readFileAsText(file);
    const rows = rawText
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0).length;
    const sliced = rawText.slice(0, MAX_EXTRACTED_TEXT_CHARS);
    return {
      id: makeAttachmentId('csv'),
      name: file.name,
      mimeType: ext === 'tsv' ? 'text/tab-separated-values' : 'text/csv',
      sizeBytes: file.size,
      kind: 'spreadsheet',
      transferMode: 'text',
      textContent: sliced,
      metaLabel: `${ext.toUpperCase() || 'CSV'} · ${rows}행 · ${formatFileSize(file.size)}`,
      source,
    };
  }

  // 7. 일반 텍스트 / 마크다운 / JSON / HTML / 이메일(EML) / 설정 문서
  const textExts = new Set([
    'txt',
    'md',
    'markdown',
    'json',
    'html',
    'htm',
    'xml',
    'yaml',
    'yml',
    'eml',
    'log',
  ]);
  if (
    textExts.has(ext) ||
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/xml'
  ) {
    if (file.size > MAX_TEXT_FILE_BYTES) {
      throw new Error(`'${file.name}' 문서가 너무 큽니다 (최대 2MB).`);
    }
    const rawText = await readFileAsText(file);
    const sliced = rawText.slice(0, MAX_EXTRACTED_TEXT_CHARS);
    const upperExt = ext ? ext.toUpperCase() : 'TXT';
    return {
      id: makeAttachmentId('doc'),
      name: file.name,
      mimeType: 'text/plain',
      sizeBytes: file.size,
      kind: 'document',
      transferMode: 'text',
      textContent: sliced,
      metaLabel: `${upperExt} · ${formatFileSize(file.size)}`,
      source,
    };
  }

  throw new Error(
    `'${file.name}' 형식은 지원되지 않습니다. (지원: 이미지, PDF, DOCX, CSV, ICS, TXT, MD, JSON, 오디오)`
  );
}

export async function processFilesForAttachment(
  files: FileList | File[],
  existingCount: number,
  source: PromptAttachmentItem['source'] = 'file'
): Promise<{ added: PromptAttachmentItem[]; errors: string[] }> {
  const list = Array.from(files);
  const errors: string[] = [];
  const added: PromptAttachmentItem[] = [];

  const availableSlots = Math.max(0, MAX_ATTACHMENTS - existingCount);
  if (availableSlots === 0) {
    return {
      added: [],
      errors: [`첨부 파일은 한 번에 최대 ${MAX_ATTACHMENTS}개까지 등록할 수 있습니다.`],
    };
  }

  const targetFiles = list.slice(0, availableSlots);
  if (list.length > availableSlots) {
    errors.push(`최대 ${MAX_ATTACHMENTS}개 제한으로 앞선 ${availableSlots}개 파일만 첨부되었습니다.`);
  }

  for (const file of targetFiles) {
    try {
      const item = await processSingleFile(file, source);
      added.push(item);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : `'${file.name}' 처리 실패`);
    }
  }

  return { added, errors };
}

/**
 * 클립보드 텍스트가 표(TSV), 캘린더(ICS), 또는 장문 회의록/안내문인지 판별하여
 * 입력창을 어지럽히지 않는 구조화된 첨부 스니펫으로 변환
 */
export function classifySmartPastedText(rawText: string): PromptAttachmentItem | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  const byteSize = new Blob([trimmed]).size;
  const sliced = trimmed.slice(0, MAX_EXTRACTED_TEXT_CHARS);

  // 1) ICS 캘린더 텍스트
  if (/BEGIN:VCALENDAR/i.test(trimmed) && /BEGIN:VEVENT/i.test(trimmed)) {
    const eventCount = (trimmed.match(/BEGIN:VEVENT/gi) || []).length;
    return {
      id: makeAttachmentId('paste-ics'),
      name: '붙여넣은_일정.ics',
      mimeType: 'text/calendar',
      sizeBytes: byteSize,
      kind: 'calendar',
      transferMode: 'text',
      textContent: sliced,
      metaLabel: `클립보드 ICS · ${eventCount}건 일정`,
      source: 'paste',
    };
  }

  // 2) 엑셀 / 스프레드시트 / 노션 탭 구분 표 (2행 이상, 각 행에 탭 포함)
  const nonEmptyLines = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const tabLines = nonEmptyLines.filter((l) => l.includes('\t'));
  if (nonEmptyLines.length >= 2 && tabLines.length >= 2) {
    return {
      id: makeAttachmentId('paste-tsv'),
      name: '붙여넣은_표_데이터.tsv',
      mimeType: 'text/tab-separated-values',
      sizeBytes: byteSize,
      kind: 'spreadsheet',
      transferMode: 'text',
      textContent: sliced,
      metaLabel: `클립보드 표 · ${nonEmptyLines.length}행`,
      source: 'paste',
    };
  }

  // 3) 장문 회의록 / 이메일 / 행사 식순 (550자 이상 또는 12줄 이상)
  if (trimmed.length >= 550 || nonEmptyLines.length >= 12) {
    return {
      id: makeAttachmentId('paste-txt'),
      name: '붙여넣은_문서_내용.txt',
      mimeType: 'text/plain',
      sizeBytes: byteSize,
      kind: 'clipboard',
      transferMode: 'text',
      textContent: sliced,
      metaLabel: `클립보드 텍스트 · ${trimmed.length.toLocaleString()}자`,
      source: 'paste',
    };
  }

  return null;
}

export function createManualSnippetAttachment(
  title: string,
  content: string
): PromptAttachmentItem {
  const cleanContent = content.trim().slice(0, MAX_EXTRACTED_TEXT_CHARS);
  const byteSize = new Blob([cleanContent]).size;
  const nonEmptyLines = cleanContent.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const isTabular = nonEmptyLines.length >= 2 && nonEmptyLines.filter((l) => l.includes('\t')).length >= 2;
  const isIcs = /BEGIN:VCALENDAR/i.test(cleanContent);

  let kind: PromptAttachmentKind = 'clipboard';
  let ext = '.txt';
  let metaPrefix = '텍스트 스니펫';

  if (isIcs) {
    kind = 'calendar';
    ext = '.ics';
    metaPrefix = 'ICS 데이터';
  } else if (isTabular) {
    kind = 'spreadsheet';
    ext = '.tsv';
    metaPrefix = `표 데이터 · ${nonEmptyLines.length}행`;
  } else {
    metaPrefix = `문서 스니펫 · ${cleanContent.length.toLocaleString()}자`;
  }

  const cleanTitle = title.trim()
    ? title.trim().includes('.')
      ? title.trim()
      : `${title.trim()}${ext}`
    : `직접_붙여넣기${ext}`;

  return {
    id: makeAttachmentId('snip'),
    name: cleanTitle,
    mimeType: isIcs ? 'text/calendar' : isTabular ? 'text/tab-separated-values' : 'text/plain',
    sizeBytes: byteSize,
    kind,
    transferMode: 'text',
    textContent: cleanContent,
    metaLabel: metaPrefix,
    source: 'paste',
  };
}

/**
 * 툴바 '클립보드 붙여넣기' 버튼 클릭 시 시스템 클립보드에서 이미지 또는 텍스트를 읽어옴
 */
export async function readSystemClipboard(
  existingCount: number
): Promise<
  | { type: 'attachments'; items: PromptAttachmentItem[]; errors: string[] }
  | { type: 'inline-text'; text: string }
  | { type: 'empty' }
  | { type: 'permission-blocked' }
> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    return { type: 'permission-blocked' };
  }

  // 1. navigator.clipboard.read()로 이미지/리치 미디어 우선 확인
  if (typeof navigator.clipboard.read === 'function') {
    try {
      const clipboardItems = await navigator.clipboard.read();
      const imageFiles: File[] = [];
      let plainText = '';

      for (const item of clipboardItems) {
        const imageType = item.types.find((t) =>
          ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(t)
        );
        if (imageType) {
          const blob = await item.getType(imageType);
          const ext = imageType.split('/')[1] || 'png';
          imageFiles.push(new File([blob], `클립보드_캡처.${ext}`, { type: imageType }));
        }
        if (item.types.includes('text/plain')) {
          const textBlob = await item.getType('text/plain');
          plainText = await textBlob.text();
        }
      }

      // 엑셀 복사 시 이미지와 탭 구분 표가 동시에 들어오는 경우 정확한 표 데이터를 우선 처리
      if (plainText.trim()) {
        const smartTextItem = classifySmartPastedText(plainText);
        if (smartTextItem && smartTextItem.kind === 'spreadsheet') {
          if (existingCount >= MAX_ATTACHMENTS) {
            return {
              type: 'attachments',
              items: [],
              errors: [`첨부 파일은 최대 ${MAX_ATTACHMENTS}개까지 가능합니다.`],
            };
          }
          return { type: 'attachments', items: [smartTextItem], errors: [] };
        }
      }

      if (imageFiles.length > 0) {
        const { added, errors } = await processFilesForAttachment(
          imageFiles,
          existingCount,
          'paste'
        );
        return { type: 'attachments', items: added, errors };
      }

      if (plainText.trim()) {
        const smartItem = classifySmartPastedText(plainText);
        if (smartItem) {
          if (existingCount >= MAX_ATTACHMENTS) {
            return {
              type: 'attachments',
              items: [],
              errors: [`첨부 파일은 최대 ${MAX_ATTACHMENTS}개까지 가능합니다.`],
            };
          }
          return { type: 'attachments', items: [smartItem], errors: [] };
        }
        return { type: 'inline-text', text: plainText };
      }

      return { type: 'empty' };
    } catch {
      // read()가 권한 또는 브라우저 정책으로 실패하면 readText()로 폴백
    }
  }

  // 2. navigator.clipboard.readText() 폴백
  if (typeof navigator.clipboard.readText === 'function') {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) return { type: 'empty' };

      const smartItem = classifySmartPastedText(text);
      if (smartItem) {
        if (existingCount >= MAX_ATTACHMENTS) {
          return {
            type: 'attachments',
            items: [],
            errors: [`첨부 파일은 최대 ${MAX_ATTACHMENTS}개까지 가능합니다.`],
          };
        }
        return { type: 'attachments', items: [smartItem], errors: [] };
      }
      return { type: 'inline-text', text };
    } catch {
      return { type: 'permission-blocked' };
    }
  }

  return { type: 'permission-blocked' };
}
