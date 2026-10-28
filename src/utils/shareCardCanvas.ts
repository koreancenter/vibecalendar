import { formatKoreanDateWithDay } from '../shared/dateUtils';
import { formatCombinedLocation } from '../shared/locationUtils';
import { getTimeZoneMeta } from '../shared/timeZoneUtils';
import { ShareCardTheme, SharedPassPayload } from './shareCodec';

interface Palette {
  bgOuter: string;
  bgCard: string;
  bgSubtle: string;
  borderOuter: string;
  divider: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accentText: string;
  notchFill: string;
}

const PALETTES: Record<ShareCardTheme, Palette> = {
  obsidian: {
    bgOuter: '#07090e',
    bgCard: '#10131c',
    bgSubtle: '#161a26',
    borderOuter: 'rgba(255, 255, 255, 0.12)',
    divider: 'rgba(255, 255, 255, 0.09)',
    textPrimary: '#f8fafc',
    textSecondary: '#cbd5e1',
    textMuted: '#64748b',
    accentText: '#e2e8f0',
    notchFill: '#07090e',
  },
  editorial: {
    bgOuter: '#f1f3f5',
    bgCard: '#ffffff',
    bgSubtle: '#f8fafc',
    borderOuter: 'rgba(15, 23, 42, 0.12)',
    divider: 'rgba(15, 23, 42, 0.09)',
    textPrimary: '#0f172a',
    textSecondary: '#334155',
    textMuted: '#64748b',
    accentText: '#0f172a',
    notchFill: '#f1f3f5',
  },
};

const SANS_STACK =
  '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif';
const MONO_STACK = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines = 4
): string[] {
  const paragraphs = text.split(/\r?\n/);
  const result: string[] = [];

  for (const para of paragraphs) {
    if (!para.trim()) {
      if (result.length > 0 && result.length < maxLines) {
        result.push('');
      }
      continue;
    }

    let current = '';
    for (const ch of Array.from(para)) {
      const test = current + ch;
      if (ctx.measureText(test).width > maxWidth && current.length > 0) {
        result.push(current);
        current = ch;
        if (result.length >= maxLines) break;
      } else {
        current = test;
      }
    }

    if (result.length >= maxLines) {
      const lastIdx = result.length - 1;
      let last = result[lastIdx];
      while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) {
        last = last.slice(0, -1);
      }
      result[lastIdx] = `${last}…`;
      return result;
    }

    if (current) {
      result.push(current);
      if (result.length >= maxLines && paragraphs.indexOf(para) < paragraphs.length - 1) {
        result[result.length - 1] = `${result[result.length - 1]}…`;
        return result;
      }
    }
  }

  return result;
}

function drawPerforatedDivider(
  ctx: CanvasRenderingContext2D,
  cardX: number,
  cardW: number,
  y: number,
  palette: Palette
) {
  ctx.save();
  ctx.strokeStyle = palette.divider;
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(cardX + 20, y);
  ctx.lineTo(cardX + cardW - 20, y);
  ctx.stroke();
  ctx.setLineDash([]);

  // 보딩패스 좌우 미세 노치(Notch) 컷아웃
  const notchR = 9;
  ctx.fillStyle = palette.notchFill;
  ctx.beginPath();
  ctx.arc(cardX, y, notchR, -Math.PI / 2, Math.PI / 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cardX + cardW, y, notchR, Math.PI / 2, (Math.PI * 3) / 2);
  ctx.fill();

  ctx.strokeStyle = palette.borderOuter;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cardX, y, notchR, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cardX + cardW, y, notchR, Math.PI / 2, (Math.PI * 3) / 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * 브리핑 패스(단일 일정 또는 프로젝트 일정표)를 고해상도 Retina PNG Blob으로 렌더링
 */
export async function renderSharePassToBlob(
  payload: SharedPassPayload,
  themeOverride?: ShareCardTheme
): Promise<Blob> {
  if (typeof document !== 'undefined' && 'fonts' in document) {
    try {
      await document.fonts.ready;
    } catch {
      // ignore font wait failure
    }
  }

  const theme = themeOverride || payload.theme || 'obsidian';
  const palette = PALETTES[theme];

  const logicalW = 600;
  const outerPad = 28;
  const cardX = outerPad;
  const cardW = logicalW - outerPad * 2;
  const innerPad = 32;
  const contentX = cardX + innerPad;
  const contentW = cardW - innerPad * 2;

  const measureCanvas = document.createElement('canvas');
  const mCtx = measureCanvas.getContext('2d');
  if (!mCtx) {
    throw new Error('캔버스 컨텍스트를 초기화할 수 없습니다.');
  }

  // 높이 사전 계산
  let bodyHeight = 0;

  if (payload.kind === 'event' && payload.event) {
    const ev = payload.event;
    mCtx.font = `700 25px ${SANS_STACK}`;
    const titleLines = wrapLines(mCtx, ev.title, contentW, 3);
    bodyHeight += 28; // 상단 킥커
    bodyHeight += titleLines.length * 34 + 24; // 타이틀
    bodyHeight += 28; // 절취선 여백
    bodyHeight += 96; // 일시 그리드 블록

    if (ev.location || ev.locationAddress) {
      bodyHeight += 20; // '장소 · 상세 주소' 라벨
      if (ev.location) {
        mCtx.font = `500 15px ${SANS_STACK}`;
        const locLines = wrapLines(mCtx, ev.location, contentW, 2);
        bodyHeight += locLines.length * 22;
      }
      if (ev.locationAddress) {
        mCtx.font = `400 12.5px ${SANS_STACK}`;
        const addrLines = wrapLines(mCtx, ev.locationAddress, contentW, 2);
        bodyHeight += (ev.location ? 4 : 0) + addrLines.length * 19;
      }
      bodyHeight += 16; // 하단 여백
    }

    if (payload.senderNote) {
      mCtx.font = `500 14px ${SANS_STACK}`;
      const noteLines = wrapLines(mCtx, payload.senderNote, contentW - 28, 3);
      bodyHeight += 20 + noteLines.length * 21 + 26;
    }

    if (ev.content) {
      mCtx.font = `400 13px ${SANS_STACK}`;
      const memoLines = wrapLines(mCtx, ev.content, contentW, 5);
      bodyHeight += 22 + memoLines.length * 20 + 16;
    }

    if (ev.checklist && ev.checklist.length > 0) {
      const shownCount = Math.min(ev.checklist.length, 6);
      bodyHeight += 26 + shownCount * 24 + 12;
    }

    bodyHeight += 54; // 하단 푸터
  } else if (payload.kind === 'project' && payload.project) {
    const pr = payload.project;
    mCtx.font = `700 24px ${SANS_STACK}`;
    const titleLines = wrapLines(mCtx, pr.name, contentW, 2);
    bodyHeight += 28;
    bodyHeight += titleLines.length * 33 + 22;
    if (payload.senderNote) {
      mCtx.font = `500 14px ${SANS_STACK}`;
      const noteLines = wrapLines(mCtx, payload.senderNote, contentW - 28, 2);
      bodyHeight += noteLines.length * 21 + 36;
    }
    bodyHeight += 28; // 절취선
    const rows = Math.max(1, Math.min(pr.events.length, 8));
    bodyHeight += rows * 48 + (pr.events.length > 8 ? 28 : 8);
    bodyHeight += 54;
  }

  const cardH = innerPad * 2 + bodyHeight;
  const logicalH = cardH + outerPad * 2;
  const scale = 2.5;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(logicalW * scale);
  canvas.height = Math.round(logicalH * scale);

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('캔버스 렌더링 컨텍스트를 생성할 수 없습니다.');
  }

  ctx.scale(scale, scale);

  // 1. 배경 캔버스
  ctx.fillStyle = palette.bgOuter;
  ctx.fillRect(0, 0, logicalW, logicalH);

  // 2. 메인 패스 카드 프레임 (단일 엘리베이션 헤어라인)
  const cardY = outerPad;
  drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 20);
  ctx.fillStyle = palette.bgCard;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = palette.borderOuter;
  ctx.stroke();

  let cursorY = cardY + innerPad;

  if (payload.kind === 'event' && payload.event) {
    const ev = payload.event;
    const tzMeta = getTimeZoneMeta(ev.timeZone);

    // 상단 언박스드 메타데이터 킥커
    ctx.font = `500 12px ${SANS_STACK}`;
    ctx.fillStyle = palette.textMuted;
    ctx.textBaseline = 'top';
    const kicker = ev.projectName
      ? `${ev.projectName} · ${ev.category}`
      : `일정 브리핑 패스 · ${ev.category}`;
    ctx.fillText(kicker, contentX, cursorY);
    cursorY += 26;

    // 일정 제목
    ctx.font = `700 25px ${SANS_STACK}`;
    ctx.fillStyle = palette.textPrimary;
    const titleLines = wrapLines(ctx, ev.title, contentW, 3);
    for (const line of titleLines) {
      ctx.fillText(line, contentX, cursorY);
      cursorY += 34;
    }
    cursorY += 18;

    // 절취선 구분선
    drawPerforatedDivider(ctx, cardX, cardW, cursorY, palette);
    cursorY += 26;

    // 일시 정보 (Tabular Monospace)
    const col2X = contentX + Math.floor(contentW * 0.48);

    ctx.font = `500 11px ${SANS_STACK}`;
    ctx.fillStyle = palette.textMuted;
    ctx.fillText('일자', contentX, cursorY);
    ctx.fillText('시간 · 기준 시간대', col2X, cursorY);
    cursorY += 20;

    ctx.font = `600 18px ${MONO_STACK}`;
    ctx.fillStyle = palette.textPrimary;
    ctx.fillText(formatKoreanDateWithDay(ev.date, false), contentX, cursorY);

    const timeDisplay = ev.isAllDay
      ? '종일 일정'
      : `${ev.startTime} – ${ev.endTime} ${tzMeta.shortCode}`;
    ctx.fillText(timeDisplay, col2X, cursorY);
    cursorY += 26;

    ctx.font = `400 12px ${SANS_STACK}`;
    ctx.fillStyle = palette.textMuted;
    if (ev.endDate && ev.endDate !== ev.date) {
      ctx.fillText(`종료일 ${ev.endDate}`, contentX, cursorY);
    }
    if (!ev.isAllDay) {
      ctx.fillText(`${tzMeta.cityKo} 현지 시각 기준`, col2X, cursorY);
    }
    cursorY += 32;

    // 장소 · 상세 주소 (2단 위계)
    if (ev.location || ev.locationAddress) {
      ctx.strokeStyle = palette.divider;
      ctx.beginPath();
      ctx.moveTo(contentX, cursorY - 10);
      ctx.lineTo(contentX + contentW, cursorY - 10);
      ctx.stroke();

      ctx.font = `500 11px ${SANS_STACK}`;
      ctx.fillStyle = palette.textMuted;
      ctx.fillText('장소 · 상세 주소', contentX, cursorY);
      cursorY += 20;

      if (ev.location) {
        ctx.font = `500 15px ${SANS_STACK}`;
        ctx.fillStyle = palette.textPrimary;
        const locLines = wrapLines(ctx, ev.location, contentW, 2);
        for (const line of locLines) {
          ctx.fillText(line, contentX, cursorY);
          cursorY += 22;
        }
      }

      if (ev.locationAddress) {
        if (ev.location) {
          cursorY += 4;
        }
        ctx.font = `400 12.5px ${SANS_STACK}`;
        ctx.fillStyle = palette.textSecondary;
        const addrLines = wrapLines(ctx, ev.locationAddress, contentW, 2);
        for (const line of addrLines) {
          ctx.fillText(line, contentX, cursorY);
          cursorY += 19;
        }
      }

      cursorY += 16;
    }

    // 현장 전달 한마디 박스 (좌측 두꺼운 보더 금지, 전체 헤어라인 적용)
    if (payload.senderNote) {
      ctx.font = `500 14px ${SANS_STACK}`;
      const noteLines = wrapLines(ctx, payload.senderNote, contentW - 28, 3);
      const boxH = 34 + noteLines.length * 21;

      drawRoundedRect(ctx, contentX, cursorY, contentW, boxH, 12);
      ctx.fillStyle = palette.bgSubtle;
      ctx.fill();
      ctx.strokeStyle = palette.divider;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.font = `500 11px ${SANS_STACK}`;
      ctx.fillStyle = palette.textMuted;
      ctx.fillText('전달 사항', contentX + 14, cursorY + 11);

      ctx.font = `500 14px ${SANS_STACK}`;
      ctx.fillStyle = palette.textPrimary;
      let noteY = cursorY + 28;
      for (const line of noteLines) {
        ctx.fillText(line, contentX + 14, noteY);
        noteY += 21;
      }
      cursorY += boxH + 16;
    }

    // 상세 메모 (선택 시)
    if (ev.content) {
      ctx.font = `500 11px ${SANS_STACK}`;
      ctx.fillStyle = palette.textMuted;
      ctx.fillText('상세 메모', contentX, cursorY);
      cursorY += 19;

      ctx.font = `400 13px ${SANS_STACK}`;
      ctx.fillStyle = palette.textSecondary;
      const memoLines = wrapLines(ctx, ev.content, contentW, 5);
      for (const line of memoLines) {
        ctx.fillText(line, contentX, cursorY);
        cursorY += 20;
      }
      cursorY += 12;
    }

    // 체크리스트 (선택 시)
    if (ev.checklist && ev.checklist.length > 0) {
      ctx.font = `500 11px ${SANS_STACK}`;
      ctx.fillStyle = palette.textMuted;
      ctx.fillText(`체크리스트 · ${ev.checklist.length}건`, contentX, cursorY);
      cursorY += 20;

      for (const item of ev.checklist.slice(0, 6)) {
        ctx.font = `500 12px ${MONO_STACK}`;
        ctx.fillStyle = palette.textMuted;
        ctx.fillText(item.done ? '[v]' : '[ ]', contentX, cursorY + 1);

        ctx.font = `400 13px ${SANS_STACK}`;
        ctx.fillStyle = item.done ? palette.textMuted : palette.textSecondary;
        const single = wrapLines(ctx, item.text, contentW - 32, 1)[0] || '';
        ctx.fillText(single, contentX + 30, cursorY);
        cursorY += 23;
      }
      cursorY += 8;
    }
  } else if (payload.kind === 'project' && payload.project) {
    const pr = payload.project;

    // 킥커
    ctx.font = `500 12px ${SANS_STACK}`;
    ctx.fillStyle = palette.textMuted;
    ctx.textBaseline = 'top';
    const metaParts = ['프로젝트 일정 브리핑'];
    if (pr.clientOrOrg) metaParts.push(pr.clientOrOrg);
    if (pr.code) metaParts.push(pr.code);
    ctx.fillText(metaParts.join(' · '), contentX, cursorY);
    cursorY += 26;

    // 프로젝트명
    ctx.font = `700 24px ${SANS_STACK}`;
    ctx.fillStyle = palette.textPrimary;
    const titleLines = wrapLines(ctx, pr.name, contentW, 2);
    for (const line of titleLines) {
      ctx.fillText(line, contentX, cursorY);
      cursorY += 33;
    }

    // 기간 및 건수 요약
    ctx.font = `500 12px ${MONO_STACK}`;
    ctx.fillStyle = palette.textSecondary;
    const periodStr =
      pr.startDate || pr.endDate
        ? `${pr.startDate || '미정'} – ${pr.endDate || '미정'} · 총 ${pr.events.length}건`
        : `등록 일정 총 ${pr.events.length}건`;
    ctx.fillText(periodStr, contentX, cursorY + 2);
    cursorY += 26;

    if (payload.senderNote) {
      ctx.font = `500 14px ${SANS_STACK}`;
      const noteLines = wrapLines(ctx, payload.senderNote, contentW - 28, 2);
      const boxH = 32 + noteLines.length * 21;
      drawRoundedRect(ctx, contentX, cursorY, contentW, boxH, 12);
      ctx.fillStyle = palette.bgSubtle;
      ctx.fill();
      ctx.strokeStyle = palette.divider;
      ctx.stroke();

      ctx.font = `500 11px ${SANS_STACK}`;
      ctx.fillStyle = palette.textMuted;
      ctx.fillText('전달 사항', contentX + 14, cursorY + 10);

      ctx.font = `500 14px ${SANS_STACK}`;
      ctx.fillStyle = palette.textPrimary;
      let ny = cursorY + 27;
      for (const line of noteLines) {
        ctx.fillText(line, contentX + 14, ny);
        ny += 21;
      }
      cursorY += boxH + 14;
    }

    drawPerforatedDivider(ctx, cardX, cardW, cursorY, palette);
    cursorY += 22;

    if (pr.events.length === 0) {
      ctx.font = `400 14px ${SANS_STACK}`;
      ctx.fillStyle = palette.textMuted;
      ctx.fillText('표시할 일정이 없습니다.', contentX, cursorY + 10);
      cursorY += 44;
    } else {
      const visible = pr.events.slice(0, 8);
      visible.forEach((ev, idx) => {
        const tzMeta = getTimeZoneMeta(ev.timeZone);
        if (idx > 0) {
          ctx.strokeStyle = palette.divider;
          ctx.beginPath();
          ctx.moveTo(contentX, cursorY - 6);
          ctx.lineTo(contentX + contentW, cursorY - 6);
          ctx.stroke();
        }

        // 좌측 날짜·시각 (Tabular)
        ctx.font = `500 12px ${MONO_STACK}`;
        ctx.fillStyle = palette.textSecondary;
        const shortDate = ev.date.slice(5).replace('-', '.');
        const shortTime = ev.isAllDay ? '종일' : `${ev.startTime} ${tzMeta.shortCode}`;
        ctx.fillText(`${shortDate}  ${shortTime}`, contentX, cursorY + 2);

        // 우측 일정명 + 장소
        const titleColX = contentX + 146;
        const titleColW = contentW - 146;
        ctx.font = `600 14px ${SANS_STACK}`;
        ctx.fillStyle = palette.textPrimary;
        const evTitle = wrapLines(ctx, ev.title, titleColW, 1)[0] || ev.title;
        ctx.fillText(evTitle, titleColX, cursorY);

        const combinedLoc = formatCombinedLocation(ev.location, ev.locationAddress);
        if (combinedLoc) {
          ctx.font = `400 12px ${SANS_STACK}`;
          ctx.fillStyle = palette.textMuted;
          const evLoc = wrapLines(ctx, combinedLoc, titleColW, 1)[0] || '';
          ctx.fillText(evLoc, titleColX, cursorY + 19);
        }

        cursorY += 46;
      });

      if (pr.events.length > 8) {
        ctx.font = `500 12px ${SANS_STACK}`;
        ctx.fillStyle = palette.textMuted;
        ctx.fillText(
          `외 ${pr.events.length - 8}건의 세부 일정은 전용 공유 링크에서 확인하실 수 있습니다.`,
          contentX,
          cursorY
        );
        cursorY += 24;
      }
    }
  }

  // 하단 푸터 헤어라인
  const footerY = cardY + cardH - innerPad - 18;
  ctx.strokeStyle = palette.divider;
  ctx.beginPath();
  ctx.moveTo(contentX, footerY - 12);
  ctx.lineTo(contentX + contentW, footerY - 12);
  ctx.stroke();

  ctx.font = `500 11px ${SANS_STACK}`;
  ctx.fillStyle = palette.textMuted;
  ctx.textBaseline = 'top';
  ctx.fillText('바이브 행사 · 브리핑 패스', contentX, footerY);

  ctx.font = `400 11px ${MONO_STACK}`;
  const issuedText = `발행 ${payload.issuedAt}`;
  const issuedW = ctx.measureText(issuedText).width;
  ctx.fillText(issuedText, contentX + contentW - issuedW, footerY);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('이미지 생성에 실패했습니다.'));
      },
      'image/png',
      1.0
    );
  });
}

/**
 * PNG Blob을 클립보드에 복사 (카카오톡·슬랙·메시지 Ctrl+V 즉시 붙여넣기 지원)
 */
export async function copySharePassImageToClipboard(blob: Blob): Promise<boolean> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.clipboard ||
    typeof ClipboardItem === 'undefined'
  ) {
    return false;
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}

/**
 * PNG 파일 다운로드
 */
export function downloadSharePassPng(blob: Blob, filename: string): void {
  const safeName = filename.replace(/[\\/:*?"<>|]/g, '_').trim() || 'briefing-pass';
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', safeName.endsWith('.png') ? safeName : `${safeName}.png`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * 모바일/OS 기본 공유 시트 지원 여부 확인
 */
export function canUseNativeShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}
