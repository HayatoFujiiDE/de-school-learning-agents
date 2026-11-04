// パッチノート本文（HTML 文字列）を「見出しの道筋 + 平文」のかたまりへ分ける純関数。
// 入力は外部（Mojang）由来の untrusted data。出力は平文のみで、タグ・属性・URL は一切残さない。
// 後段で HTML や prompt に埋め込む側は、この平文を通常のテキストとしてエスケープして扱うこと。

export interface TextBlock {
  heading_path: string[];
  text: string;
}

export interface HtmlToBlocksLimits {
  /** 1 かたまりの最大文字数（超えた分は切り捨て、末尾に … を付ける） */
  maxTextChars?: number;
  /** かたまりの最大数（超えたら以降は捨てる） */
  maxBlocks?: number;
  /** heading_path の最大段数 */
  maxDepth?: number;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  times: '×',
  copy: '©',
  reg: '®',
  trade: '™',
};

/** 文字参照を平文へ戻す。不正な符号位置は捨てる */
export function decodeEntities(s: string): string {
  return s.replace(/&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z][a-zA-Z0-9]{0,31});/g, (m, body: string) => {
    if (body[0] === '#') {
      const cp = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '';
      return String.fromCodePoint(cp);
    }
    const v = NAMED_ENTITIES[body.toLowerCase()];
    return v ?? m;
  });
}

/** 制御文字を除き、空白をまとめる */
export function cleanText(s: string): string {
  return s
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b\u2028\u2029\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 区切りになる要素（ここで平文を切る）
const BLOCK_TAGS = new Set([
  'p', 'li', 'ul', 'ol', 'pre', 'blockquote', 'div', 'section', 'article', 'table', 'tr', 'td', 'th',
  'thead', 'tbody', 'dl', 'dt', 'dd', 'hr', 'figure', 'figcaption', 'header', 'footer', 'details', 'summary',
]);
// 中身ごと捨てる要素
const DROP_CONTENT_RE = /<(script|style|template|noscript|iframe|svg|math|object)\b[\s\S]*?<\/\1\s*>/gi;
// タグ（属性の引用符内の > に耐える）/ 文字列 / はぐれ <
const TOKEN_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b(?:"[^"]*"|'[^']*'|[^'">])*>|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[^>]*>|[^<]+|</g;

export function htmlToBlocks(html: string, limits: HtmlToBlocksLimits = {}): TextBlock[] {
  const maxTextChars = limits.maxTextChars ?? 4000;
  const maxBlocks = limits.maxBlocks ?? 5000;
  const maxDepth = limits.maxDepth ?? 8;

  const src = html.replace(/<!--[\s\S]*?(?:-->|$)/g, ' ').replace(DROP_CONTENT_RE, ' ');
  const out: TextBlock[] = [];
  const headings: (string | undefined)[] = []; // index 0 = h1
  let headingLevel = 0; // 見出しの中にいる時の段（1〜6）、外は 0
  let headingBuf = '';
  let buf = '';
  // li の入れ子。各要素はその li 自身の最初の平文（子の見出しの道筋に使う）
  const liStack: (string | null)[] = [];

  const clip = (t: string) => (t.length > maxTextChars ? t.slice(0, maxTextChars - 1) + '…' : t);

  const flush = () => {
    const text = cleanText(decodeEntities(buf));
    buf = '';
    if (!text) return;
    const top = liStack.length - 1;
    if (top >= 0 && liStack[top] === null) liStack[top] = clip(text);
    if (out.length >= maxBlocks) return;
    const path: string[] = [];
    for (const h of headings) if (h) path.push(h);
    // 祖先の li（自分自身は除く）
    for (let i = 0; i < top; i++) {
      const c = liStack[i];
      if (c) path.push(c);
    }
    out.push({ heading_path: path.slice(0, maxDepth), text: clip(text) });
  };

  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(src)) !== null) {
    const tok = m[0];
    const name = m[2]?.toLowerCase();
    if (!name) {
      if (tok.startsWith('<![CDATA[')) {
        // CDATA は平文として扱う
        const inner = tok.slice(9, -3);
        if (headingLevel) headingBuf += inner;
        else buf += inner;
      } else if (tok.startsWith('<!') || tok.startsWith('<?')) {
        // doctype / 処理命令は捨てる
      } else if (headingLevel) headingBuf += tok;
      else buf += tok;
      continue;
    }
    const closing = m[1] === '/';
    const hm = /^h([1-6])$/.exec(name);
    if (hm) {
      const level = Number(hm[1]);
      if (!closing) {
        flush();
        headingLevel = level;
        headingBuf = '';
      } else if (headingLevel) {
        const text = clip(cleanText(decodeEntities(headingBuf)));
        headings.length = headingLevel - 1;
        headings[headingLevel - 1] = text || undefined;
        headingLevel = 0;
        headingBuf = '';
      }
      continue;
    }
    if (name === 'br') {
      if (headingLevel) headingBuf += ' ';
      else buf += ' ';
      continue;
    }
    if (BLOCK_TAGS.has(name)) {
      if (headingLevel) {
        headingBuf += ' ';
        continue;
      }
      flush();
      if (name === 'li') {
        if (!closing) liStack.push(null);
        else if (liStack.length) liStack.pop();
      }
      continue;
    }
    // それ以外（a / code / strong / em / span / img 等）はタグだけ捨てて中身の平文を残す
  }
  flush();
  return out;
}
