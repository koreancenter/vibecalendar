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

export interface NormalizedCoordinates {
  locationLat?: number;
  locationLng?: number;
}

function parseSingleCoordinateValue(raw: unknown, maxAbs: number): number | undefined {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || Math.abs(raw) > maxAbs) return undefined;
    return Math.round(raw * 1_000_000) / 1_000_000;
  }
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  const dirMatch = trimmed.match(/^([NSEWnsew])?\s*([+-]?\d+(?:\.\d+)?)\s*°?\s*([NSEWnsew])?$/);
  if (!dirMatch) return undefined;

  let value = Number(dirMatch[2]);
  if (!Number.isFinite(value)) return undefined;

  const dir = (dirMatch[1] || dirMatch[3] || '').toUpperCase();
  if (dir === 'S' || dir === 'W') {
    value = -Math.abs(value);
  } else if (dir === 'N' || dir === 'E') {
    value = Math.abs(value);
  }

  if (Math.abs(value) > maxAbs) return undefined;
  return Math.round(value * 1_000_000) / 1_000_000;
}

/**
 * 위도(-90~90) 및 경도(-180~180) 쌍 검증 및 소수점 6자리 정규화
 */
export function normalizeCoordinates(
  rawLat?: unknown,
  rawLng?: unknown
): NormalizedCoordinates {
  const lat = parseSingleCoordinateValue(rawLat, 90);
  const lng = parseSingleCoordinateValue(rawLng, 180);

  if (lat === undefined || lng === undefined) {
    return {};
  }
  // 숫자 0, 0 기본값(Null Island) 오입력 방지 (단, 문자열 '0' 명시 입력은 허용)
  if (lat === 0 && lng === 0 && typeof rawLat === 'number' && typeof rawLng === 'number') {
    return {};
  }

  return {
    locationLat: lat,
    locationLng: lng,
  };
}

/**
 * "37.566535, 126.977969" 또는 "@37.566535,126.977969" 형태의 문자열에서 위경도 쌍 추출
 */
export function parseCoordinatePairFromString(
  raw: string
): { lat: number; lng: number } | null {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(/^@/, '');
  const parts = cleaned.split(/\s*[,/]\s*|\s{2,}/).filter(Boolean);
  if (parts.length !== 2) {
    const spaceParts = cleaned.split(/\s+/).filter(Boolean);
    if (spaceParts.length === 2) {
      const norm = normalizeCoordinates(spaceParts[0], spaceParts[1]);
      if (norm.locationLat !== undefined && norm.locationLng !== undefined) {
        return { lat: norm.locationLat, lng: norm.locationLng };
      }
    }
    return null;
  }
  const norm = normalizeCoordinates(parts[0], parts[1]);
  if (norm.locationLat === undefined || norm.locationLng === undefined) {
    return null;
  }
  return { lat: norm.locationLat, lng: norm.locationLng };
}

export function hasValidCoordinates(
  lat?: number | null,
  lng?: number | null
): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

export function formatLatitudeDecimal(lat: number): string {
  const hemisphere = lat >= 0 ? 'N' : 'S';
  return `${Math.abs(lat).toFixed(6)}° ${hemisphere}`;
}

export function formatLongitudeDecimal(lng: number): string {
  const hemisphere = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lng).toFixed(6)}° ${hemisphere}`;
}

export function formatCoordinatePairPlain(lat: number, lng: number): string {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

function toDMSSingle(value: number, posChar: string, negChar: string): string {
  const dir = value >= 0 ? posChar : negChar;
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = (minFloat - min) * 60;
  return `${deg}°${String(min).padStart(2, '0')}′${sec.toFixed(1).padStart(4, '0')}″${dir}`;
}

export function formatCoordinateDMS(lat: number, lng: number): string {
  return `${toDMSSingle(lat, 'N', 'S')} · ${toDMSSingle(lng, 'E', 'W')}`;
}

/**
 * 위경도 또는 장소·주소 질의어로 외부 Google 지도 URL 생성 (window.open 없이 <a target="_blank"> 전용)
 */
export function buildGoogleMapsPinUrl(params: {
  location?: string;
  locationAddress?: string;
  locationLat?: number;
  locationLng?: number;
  isSample?: boolean;
}): string {
  const { location, locationAddress, locationLat, locationLng, isSample } = params;
  if (hasValidCoordinates(locationLat, locationLng)) {
    const coordQuery = `${locationLat!.toFixed(6)},${locationLng!.toFixed(6)}`;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coordQuery)}`;
  }
  if (!isSample) {
    const searchQuery = buildLocationSearchQuery(location, locationAddress);
    if (searchQuery) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(searchQuery)}`;
    }
  }
  return 'https://www.google.com/maps';
}

interface RegionalAnchor {
  pattern: RegExp;
  lat: number;
  lng: number;
  label: string;
}

const REGIONAL_ANCHORS: RegionalAnchor[] = [
  { pattern: /성동구|성수/, lat: 37.54458, lng: 127.05597, label: '서울 성동권역' },
  { pattern: /강남구|역삼|삼성동|테헤란로|코엑스|청담|압구정/, lat: 37.50881, lng: 127.06012, label: '서울 강남권역' },
  { pattern: /서초구|반포|양재/, lat: 37.49195, lng: 127.00768, label: '서울 서초권역' },
  { pattern: /송파구|잠실|올림픽로/, lat: 37.51326, lng: 127.10013, label: '서울 송파권역' },
  { pattern: /용산구|한남|이태원/, lat: 37.5326, lng: 126.9904, label: '서울 용산권역' },
  { pattern: /영등포|여의도/, lat: 37.52451, lng: 126.92542, label: '서울 여의도권역' },
  { pattern: /마포구|상암|홍대|합정/, lat: 37.56632, lng: 126.90149, label: '서울 마포권역' },
  { pattern: /종로구|광화문|종각/, lat: 37.57295, lng: 126.97936, label: '서울 광화문권역' },
  { pattern: /중구|을지로|명동|서울역/, lat: 37.56412, lng: 126.98155, label: '서울 도심권역' },
  { pattern: /마곡|강서구/, lat: 37.56095, lng: 126.82724, label: '서울 마곡권역' },
  { pattern: /분당|판교|성남/, lat: 37.39476, lng: 127.11116, label: '성남 판교·분당권역' },
  { pattern: /수원|광교/, lat: 37.28471, lng: 127.05582, label: '수원·광교권역' },
  { pattern: /고양|일산|킨텍스/, lat: 37.66905, lng: 126.74582, label: '고양 일산권역' },
  { pattern: /의정부/, lat: 37.73808, lng: 127.04591, label: '경기 의정부권역' },
  { pattern: /인천|송도/, lat: 37.39175, lng: 126.64326, label: '인천 송도권역' },
  { pattern: /부산|해운대|벡스코/, lat: 35.16895, lng: 129.13604, label: '부산 해운대권역' },
  { pattern: /대전|유성/, lat: 36.37462, lng: 127.38124, label: '대전 유성권역' },
  { pattern: /대구|엑스코/, lat: 35.90642, lng: 128.61264, label: '대구권역' },
  { pattern: /광주/, lat: 35.15954, lng: 126.8526, label: '광주권역' },
  { pattern: /제주|서귀포/, lat: 33.48901, lng: 126.4983, label: '제주권역' },
  { pattern: /자카르타|Jakarta/i, lat: -6.20876, lng: 106.8456, label: 'Jakarta' },
  { pattern: /발리|Bali/i, lat: -8.65, lng: 115.21667, label: 'Bali' },
  { pattern: /싱가포르|Singapore/i, lat: 1.28967, lng: 103.85007, label: 'Singapore' },
  { pattern: /도쿄|Tokyo/i, lat: 35.6762, lng: 139.6503, label: 'Tokyo' },
  { pattern: /뉴욕|New\s*York/i, lat: 40.758, lng: -73.9855, label: 'New York' },
  { pattern: /런던|London/i, lat: 51.5074, lng: -0.1278, label: 'London' },
  { pattern: /파리|Paris/i, lat: 48.8566, lng: 2.3522, label: 'Paris' },
];

/**
 * 정밀 좌표가 아직 입력되지 않은 일정을 위해 주소·장소 텍스트에서 시각적 지도 프리뷰 기준점을 추정
 */
export function inferRegionalMapAnchor(
  location?: string,
  locationAddress?: string
): { lat: number; lng: number; regionLabel: string } {
  const combined = `${locationAddress || ''} ${location || ''}`.trim();
  for (const anchor of REGIONAL_ANCHORS) {
    if (anchor.pattern.test(combined)) {
      return {
        lat: anchor.lat,
        lng: anchor.lng,
        regionLabel: anchor.label,
      };
    }
  }
  return {
    lat: 37.566535,
    lng: 126.977969,
    regionLabel: '서울 기준 프리뷰',
  };
}

