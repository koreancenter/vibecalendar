/**
 * 장소명(location)과 상세 주소(locationAddress) 정규화 · 모호 표현('~인근', '~근처', '~부근') 제거 유틸리티
 * 클라이언트 및 서버(Gemini 에이전트) 공용 모듈
 */

export interface NormalizedLocationPair {
  location?: string;
  locationAddress?: string;
}

const VAGUE_PLACEHOLDER_ADDRESSES = new Set([
  '상세 주소 확인 필요',
  '주소 확인 필요',
  '주소 미상',
  '미상',
  '미정',
  '장소 미정',
  '-',
  '없음',
  'N/A',
  'TBD',
]);

const ADDRESS_SIGNAL_REGEX =
  /(?:특별자치시|특별자치도|특별시|광역시|[가-힣]{2,6}(?:시|도)\s+[가-힣]{1,8}(?:시|군|구)|[가-힣0-9]+(?:대로|로|길|번길)\s*\d|[가-힣]+(?:동|읍|면|리)\s+\d|\b\d+\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Jl\.|Jalan)\b)/i;

const INTERNAL_OR_VIRTUAL_REGEX =
  /^(?:본사|사내|자사|내부|대회의실|소회의실|중회의실|회의실|임원실|보드룸|온라인|화상|비대면|재택|자택|미정|Zoom|Google\s*Meet|Microsoft\s*Teams|Teams|Webex)/i;

function stripVagueModifiers(raw: string): string {
  let s = raw.replace(/\s+/g, ' ').trim();
  if (!s) return '';

  // 1) "의정부역 인근 한식당 (오뎅식당 본점)" 처럼 앞쪽이 '~인근/근처/부근/일대 [업종]'이고 괄호 안에 실제 상호명이 있는 경우 괄호 안 공식 명칭 채택
  const vaguePrefixWithExactParen = s.match(
    /^.+?(?:인근|근처|부근|일대|주변)\s*[가-힣A-Za-z\s]*\(([^()]{2,80})\)\s*$/
  );
  if (vaguePrefixWithExactParen && !ADDRESS_SIGNAL_REGEX.test(vaguePrefixWithExactParen[1])) {
    s = vaguePrefixWithExactParen[1].trim();
  }

  // 2) 앞쪽 모호 수식어 제거 (예: "강남역 인근 코엑스 오디토리움" -> "코엑스 오디토리움")
  s = s.replace(
    /^[가-힣A-Za-z0-9·\-\s]{1,20}?\s+(?:인근|근처|부근|일대|주변)(?:의)?\s+(?=[가-힣A-Za-z0-9]{2,})/,
    ''
  );

  // 3) 후행 모호 수식어 제거 (예: "서울역 인근", "광화문 부근" 등 불필요한 꼬리표 정제)
  s = s
    .replace(/\s*(?:인근|근처|부근|일대|주변)(?:\s*(?:식당|한식당|일식당|중식당|레스토랑|카페|회의실|장소|건물))?\s*$/g, '')
    .trim();

  return s;
}

function cleanAddressText(raw: string): string {
  const trimmed = raw.replace(/\s+/g, ' ').trim();
  if (!trimmed || VAGUE_PLACEHOLDER_ADDRESSES.has(trimmed)) return '';
  return stripVagueModifiers(trimmed);
}

/**
 * 단일 문자열 또는 분리된 (location, locationAddress) 입력을 받아
 * '~인근/근처/부근' 같은 모호한 표현을 걷어내고 정확한 장소명과 상세 주소로 정규화합니다.
 */
export function normalizePlaceAndAddress(
  rawLocation?: unknown,
  rawAddress?: unknown
): NormalizedLocationPair {
  let loc = typeof rawLocation === 'string' ? rawLocation.replace(/\s+/g, ' ').trim() : '';
  let addr = typeof rawAddress === 'string' ? cleanAddressText(rawAddress) : '';

  if (!loc && !addr) {
    return {};
  }

  // location 내부에 "장소명 (서울특별시 ...)" 형태로 주소가 괄호로 병기된 경우 분리
  if (loc) {
    const trailingParenMatch = loc.match(/^(.+?)\s*\(([^()]{5,140})\)\s*$/);
    if (trailingParenMatch) {
      const outside = trailingParenMatch[1].trim();
      const inside = trailingParenMatch[2].trim();

      if (!addr && ADDRESS_SIGNAL_REGEX.test(inside)) {
        loc = outside;
        addr = cleanAddressText(inside);
      } else if (
        /(?:인근|근처|부근|일대|주변)/.test(outside) &&
        !ADDRESS_SIGNAL_REGEX.test(inside)
      ) {
        loc = inside;
      }
    }
  }

  // "서울특별시 강남구 영동대로 513 · 코엑스 오디토리움" 처럼 구분자로 합쳐진 경우 분리
  if (loc && !addr && /\s+[·|—]\s+/.test(loc)) {
    const parts = loc.split(/\s+[·|—]\s+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 2) {
      if (ADDRESS_SIGNAL_REGEX.test(parts[1]) && !ADDRESS_SIGNAL_REGEX.test(parts[0])) {
        loc = parts[0];
        addr = cleanAddressText(parts[1]);
      } else if (ADDRESS_SIGNAL_REGEX.test(parts[0]) && !ADDRESS_SIGNAL_REGEX.test(parts[1])) {
        addr = cleanAddressText(parts[0]);
        loc = parts[1];
      }
    }
  }

  loc = stripVagueModifiers(loc);

  // location 자체가 순수 도로명/지번 주소이고 별도 상호명이 없는 경우 그대로 location에 유지하되 중복 방지
  if (addr && loc && addr.toLowerCase() === loc.toLowerCase()) {
    addr = '';
  }

  return {
    location: loc || undefined,
    locationAddress: addr || undefined,
  };
}

/**
 * ICS LOCATION 필드, 텍스트 복사, PDF 명세표 등 한 줄 병기가 필요한 곳을 위한 포맷터
 */
export function formatCombinedLocation(
  location?: string,
  locationAddress?: string,
  separator = ' · '
): string {
  const { location: cleanLoc, locationAddress: cleanAddr } = normalizePlaceAndAddress(
    location,
    locationAddress
  );
  if (cleanLoc && cleanAddr) {
    if (cleanLoc.includes(cleanAddr)) return cleanLoc;
    return `${cleanLoc}${separator}${cleanAddr}`;
  }
  return cleanLoc || cleanAddr || '';
}

/**
 * 외부 지도 검색 링크 생성을 위한 정확한 검색 질의 문자열
 */
export function buildLocationSearchQuery(
  location?: string,
  locationAddress?: string
): string {
  const { location: cleanLoc, locationAddress: cleanAddr } = normalizePlaceAndAddress(
    location,
    locationAddress
  );
  if (cleanLoc && cleanAddr) {
    return `${cleanLoc} ${cleanAddr}`.trim();
  }
  return cleanAddr || cleanLoc || '';
}

/**
 * 사내 회의실·화상회의 등 외부 도로명 주소 검색 대상이 아닌 장소인지 판별
 */
export function isInternalOrVirtualLocation(location?: string): boolean {
  if (!location || !location.trim()) return true;
  return INTERNAL_OR_VIRTUAL_REGEX.test(location.trim());
}
