import { ProjectStatus } from '../types';

export interface ParsedProjectResult {
  name?: string;
  code?: string;
  clientOrOrg?: string;
  startDate?: string;
  endDate?: string;
  status?: ProjectStatus;
  description?: string;
}

/**
 * 프로젝트명을 기반으로 간결하고 품격 있는 영문 식별 코드를 자동 생성합니다.
 */
export function generateProjectCode(name: string): string {
  if (!name || !name.trim()) return '';

  const clean = name.trim();

  // 1. 이미 영문 단어가 포함된 경우 (예: Vibe AI 캘린더 -> VIBE-AI)
  const englishWords = clean.match(/[A-Za-z0-9]+/g);
  if (englishWords && englishWords.length >= 2) {
    return englishWords.slice(0, 2).join('-').toUpperCase().slice(0, 8);
  }
  if (englishWords && englishWords.length === 1 && englishWords[0].length >= 3) {
    return englishWords[0].toUpperCase().slice(0, 7);
  }

  // 2. 알려진 한국어 키워드 매핑
  const map: Record<string, string> = {
    루미에르: 'LUM',
    오르비에: 'ORB',
    아스트라: 'AST',
    노바: 'NOVA',
    산학협력: 'COL',
    협약: 'MOU',
    파트너: 'PTN',
    파트너스: 'PTN',
    살롱: 'SALON',
    글로벌: 'GLB',
    런칭: 'LNCH',
    행사: 'EVENT',
    컨퍼런스: 'CONF',
    세미나: 'SMNR',
    워크샵: 'WKSP',
    전시: 'EXHB',
    팝업: 'POPUP',
    프로젝트: 'PROJ',
    하반기: 'H2',
    상반기: 'H1',
  };

  const matchedTokens: string[] = [];
  for (const [kr, en] of Object.entries(map)) {
    if (clean.includes(kr)) {
      matchedTokens.push(en);
      if (matchedTokens.length >= 2) break;
    }
  }

  if (matchedTokens.length > 0) {
    return matchedTokens.join('-').slice(0, 8);
  }

  // 3. 일반적인 음절 이니셜 또는 축약 (한글 초성/음절)
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0].slice(0, 2) + '-' + words[1].slice(0, 2)).toUpperCase().slice(0, 7);
  }

  return clean.slice(0, 4).toUpperCase();
}

/**
 * 자연어 문장을 분석하여 프로젝트 속성들을 스마트하게 추출합니다.
 */
export function parseProjectPrompt(prompt: string, currentYear = 2026): ParsedProjectResult {
  const result: ParsedProjectResult = {};
  if (!prompt || !prompt.trim()) return result;

  let text = prompt.trim();

  // 1. 파트너사 / 조직 추출 (예: "파트너: 루미에르 미래기술원", "고객사: 아스트라 스튜디오")
  const clientMatch = text.match(/(?:파트너|파트너사|고객사|조직|협력사|주최|의뢰)[\s:：]+([^\s,()]+(?:\s+[^\s,()]+)?)/i) ||
                      text.match(/루미에르\s*미래기술원|오르비에\s*파트너스|아스트라\s*스튜디오/i);
  if (clientMatch) {
    result.clientOrOrg = clientMatch[1] ? clientMatch[1].trim() : clientMatch[0].trim();
    // 텍스트에서 파트너 부분 제거
    text = text.replace(clientMatch[0], '');
  }

  // 2. 날짜 추출
  // 2-1) "10/1 ~ 11/30" 또는 "10.1 ~ 11.30"
  const slashRange = text.match(/(\d{1,2})[/.월]\s*(\d{1,2})[일]?\s*(?:~|-|부터)\s*(\d{1,2})[/.월]\s*(\d{1,2})[일]?/);
  if (slashRange) {
    const sm = String(parseInt(slashRange[1], 10)).padStart(2, '0');
    const sd = String(parseInt(slashRange[2], 10)).padStart(2, '0');
    const em = String(parseInt(slashRange[3], 10)).padStart(2, '0');
    const ed = String(parseInt(slashRange[4], 10)).padStart(2, '0');
    result.startDate = `${currentYear}-${sm}-${sd}`;
    result.endDate = `${currentYear}-${em}-${ed}`;
    text = text.replace(slashRange[0], '');
  } else {
    // 2-2) "10월부터 11월 말까지" 또는 "10월 ~ 12월"
    const monthRange = text.match(/(\d{1,2})월\s*(?:초|중순)?\s*(?:부터|~|-)\s*(\d{1,2})월\s*(말|말까지|말일)?/);
    if (monthRange) {
      const sm = String(parseInt(monthRange[1], 10)).padStart(2, '0');
      const em = String(parseInt(monthRange[2], 10)).padStart(2, '0');
      result.startDate = `${currentYear}-${sm}-01`;
      // 말일 계산
      const endMNum = parseInt(em, 10);
      const lastDay = new Date(currentYear, endMNum, 0).getDate();
      result.endDate = `${currentYear}-${em}-${String(lastDay).padStart(2, '0')}`;
      text = text.replace(monthRange[0], '');
    } else if (text.includes('올해 말') || text.includes('연말')) {
      result.startDate = `${currentYear}-10-01`;
      result.endDate = `${currentYear}-12-31`;
    }
  }

  // 3. 상태 감지
  if (text.includes('기획') || text.includes('준비') || text.includes('구상')) {
    result.status = 'planning';
  } else if (text.includes('완료') || text.includes('마감')) {
    result.status = 'completed';
  } else if (text.includes('보류') || text.includes('대기')) {
    result.status = 'on_hold';
  } else {
    result.status = 'active';
  }

  // 4. 잔여 문장에서 프로젝트명 정제
  let cleanedName = text
    .replace(/(?:등록해줘|만들어줘|생성해줘|추가해줘|프로젝트\s*등록|일정|신규)/g, '')
    .replace(/[()[\]{}~,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleanedName.length >= 2) {
    result.name = cleanedName;
    result.code = generateProjectCode(cleanedName);
  }

  return result;
}
