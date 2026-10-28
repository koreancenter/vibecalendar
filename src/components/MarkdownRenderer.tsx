import React, { useMemo } from 'react';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

const SAFE_PROTOCOL_REGEX = /^(https?:|mailto:|tel:)/i;

function isSafeHref(rawUrl: string): boolean {
  const trimmed = rawUrl.trim();
  if (!trimmed) return false;
  return SAFE_PROTOCOL_REGEX.test(trimmed);
}

/**
 * 인라인 마크다운 토큰(`코드`, **굵게**, *기울임*, ~~취소선~~, [링크](url))을
 * dangerouslySetInnerHTML 없이 순수 React 노드로 안전하게 변환
 */
function renderInlineNodes(text: string, keyPrefix: string): React.ReactNode[] {
  if (!text) return [];

  const tokenRegex =
    /(`[^`\n]+`|\*\*[^*\n]+\*\*|~~[^~\n]+~~|\[[^\]]+\]\([^)\s]+\)|\*[^*\n]+\*)/g;

  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let tokenIdx = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    const key = `${keyPrefix}-t-${tokenIdx++}`;

    if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(
        <code
          key={key}
          className="px-1.5 py-0.5 rounded bg-white/[0.08] text-indigo-300 font-mono text-[11px] border border-white/[0.08]"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(
        <strong key={key} className="font-semibold text-white">
          {renderInlineNodes(token.slice(2, -2), key)}
        </strong>
      );
    } else if (token.startsWith('~~') && token.endsWith('~~')) {
      nodes.push(
        <del key={key} className="line-through text-neutral-400">
          {renderInlineNodes(token.slice(2, -2), key)}
        </del>
      );
    } else if (token.startsWith('[') && token.includes('](') && token.endsWith(')')) {
      const splitIdx = token.indexOf('](');
      const label = token.slice(1, splitIdx);
      const rawUrl = token.slice(splitIdx + 2, -1);

      if (isSafeHref(rawUrl)) {
        nodes.push(
          <a
            key={key}
            href={rawUrl.trim()}
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-300 underline underline-offset-2 hover:text-indigo-200 transition-colors"
          >
            {label}
          </a>
        );
      } else {
        nodes.push(<span key={key}>{label}</span>);
      }
    } else if (token.startsWith('*') && token.endsWith('*')) {
      nodes.push(
        <em key={key} className="italic text-neutral-100">
          {renderInlineNodes(token.slice(1, -1), key)}
        </em>
      );
    } else {
      nodes.push(token);
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

type ParsedBlock =
  | { type: 'code'; lang: string; content: string }
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'blockquote'; lines: string[] }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'paragraph'; lines: string[] };

function parseMarkdownBlocks(markdown: string): ParsedBlock[] {
  if (!markdown) return [];

  const normalized = markdown.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const blocks: ParsedBlock[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // 1. 펜스 코드 블록 (```)
    if (line.trimStart().startsWith('```')) {
      const lang = line.trimStart().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      blocks.push({ type: 'code', lang, content: codeLines.join('\n') });
      continue;
    }

    // 빈 줄 건너뛰기
    if (!line.trim()) {
      i++;
      continue;
    }

    // 2. 제목 (# ~ ###)
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = Math.min(3, headingMatch[1].length) as 1 | 2 | 3;
      blocks.push({ type: 'heading', level, text: headingMatch[2].trim() });
      i++;
      continue;
    }

    // 3. 인용문 (>)
    if (/^\s*>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'blockquote', lines: quoteLines });
      continue;
    }

    // 4. 비순서 목록 (- / * / •)
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*•]\s+/, ''));
        i++;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    // 5. 순서 목록 (1. )
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }

    // 6. 일반 문단
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].trimStart().startsWith('```') &&
      !/^(#{1,3})\s+/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !/^\s*[-*•]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: 'paragraph', lines: paraLines });
    }
  }

  return blocks;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  className = '',
}) => {
  const blocks = useMemo(() => parseMarkdownBlocks(content), [content]);

  return (
    <div className={`space-y-2 text-xs leading-relaxed break-words ${className}`}>
      {blocks.map((block, bIdx) => {
        const key = `blk-${bIdx}`;

        if (block.type === 'code') {
          return (
            <pre
              key={key}
              className="p-2.5 rounded-lg bg-black/40 border border-white/[0.08] overflow-x-auto font-mono text-[11px] text-neutral-200"
            >
              <code>{block.content}</code>
            </pre>
          );
        }

        if (block.type === 'heading') {
          const sizeClass =
            block.level === 1
              ? 'text-sm font-bold text-white'
              : block.level === 2
              ? 'text-xs font-bold text-white'
              : 'text-xs font-semibold text-neutral-100';
          return (
            <div key={key} className={sizeClass}>
              {renderInlineNodes(block.text, key)}
            </div>
          );
        }

        if (block.type === 'blockquote') {
          return (
            <blockquote
              key={key}
              className="pl-2.5 border-l-2 border-indigo-400/50 text-neutral-300 space-y-0.5"
            >
              {block.lines.map((ln, lIdx) => (
                <p key={`${key}-q-${lIdx}`}>{renderInlineNodes(ln, `${key}-q-${lIdx}`)}</p>
              ))}
            </blockquote>
          );
        }

        if (block.type === 'ul') {
          return (
            <ul key={key} className="space-y-1 pl-3.5 list-disc marker:text-indigo-400">
              {block.items.map((item, iIdx) => (
                <li key={`${key}-ul-${iIdx}`}>
                  {renderInlineNodes(item, `${key}-ul-${iIdx}`)}
                </li>
              ))}
            </ul>
          );
        }

        if (block.type === 'ol') {
          return (
            <ol key={key} className="space-y-1 pl-4 list-decimal marker:text-indigo-300 font-normal">
              {block.items.map((item, iIdx) => (
                <li key={`${key}-ol-${iIdx}`}>
                  {renderInlineNodes(item, `${key}-ol-${iIdx}`)}
                </li>
              ))}
            </ol>
          );
        }

        return (
          <p key={key} className="whitespace-pre-wrap">
            {block.lines.map((ln, lIdx) => (
              <React.Fragment key={`${key}-p-${lIdx}`}>
                {lIdx > 0 && '\n'}
                {renderInlineNodes(ln, `${key}-p-${lIdx}`)}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
};
