import { marked, type Token, type Tokens } from "marked";
import type { Content, TDocumentDefinitions, TFontDictionary } from "pdfmake/interfaces";

export type MarkdownPdfInput = {
  title: string;
  body: string;
  courseLabel: string;
};
export type PdfImageResolver = (url: string) => Promise<string>;
type PdfNode = Record<string, unknown>;
type Inline = { text: string; [key: string]: unknown };

const imagePathPattern = /^\/api\/note-images\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const bodyWidth = 499.28;
const fontFiles = ["NotoSansSC-Regular.otf", "NotoSansSC-Bold.otf"] as const;
const fontDictionary: TFontDictionary = {
  NotoSansSC: {
    normal: fontFiles[0],
    bold: fontFiles[1],
    italics: fontFiles[0],
    bolditalics: fontFiles[1],
  },
};

/** Uploaded images use authenticated, same-origin routes; arbitrary URLs are never fetched. */
export function isNoteImageUrl(value: string): boolean {
  return imagePathPattern.test(value);
}

function safeLink(href: string): string | undefined {
  try {
    const url = new URL(href);
    if (url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:") return href;
  } catch {}
  return undefined;
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, code: string) => {
    if (code[0] !== "#") return named[code.toLowerCase()] ?? whole;
    const point = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return Number.isFinite(point) && point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
      ? String.fromCodePoint(point) : whole;
  });
}

function tokenInline(tokens: Token[] | undefined, fallback = "", inherited: Record<string, unknown> = {}): Inline[] {
  if (!tokens?.length) return [{ text: decodeEntities(fallback), ...inherited }];
  const result: Inline[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case "strong": result.push(...tokenInline(token.tokens, token.text, { ...inherited, bold: true })); break;
      case "em": result.push(...tokenInline(token.tokens, token.text, { ...inherited, italics: true, color: "#49645a" })); break;
      case "del": result.push(...tokenInline(token.tokens, token.text, { ...inherited, decoration: "lineThrough" })); break;
      case "codespan": result.push({ text: decodeEntities(token.text), ...inherited, background: "#eff3f0", color: "#225c48", fontSize: 9.5 }); break;
      case "br": result.push({ text: "\n", ...inherited }); break;
      case "link": {
        const link = safeLink(token.href);
        result.push(...tokenInline(token.tokens, token.text, { ...inherited, ...(link ? { link, color: "#27694e", decoration: "underline" } : {}) }));
        break;
      }
      case "image": result.push({ text: "[" + decodeEntities(token.text || "图片") + "]", ...inherited }); break;
      case "html": break;
      default: {
        const item = token as Token & { text?: string; tokens?: Token[] };
        if (item.tokens) result.push(...tokenInline(item.tokens, item.text, inherited));
        else if (typeof item.text === "string") result.push({ text: decodeEntities(item.text), ...inherited });
      }
    }
  }
  return result;
}

function collectImages(tokens: Token[], target: Set<string>): void {
  for (const token of tokens) {
    if (token.type === "image") {
      if (!isNoteImageUrl(token.href)) throw new Error("图片请先通过“上传图片”加入笔记，再使用生成的图片地址。");
      target.add(token.href);
    }
    const item = token as Token & { tokens?: Token[] };
    if (item.tokens) collectImages(item.tokens, target);
    if (token.type === "list") for (const child of token.items) collectImages(child.tokens, target);
    if (token.type === "table") for (const cell of [...token.header, ...token.rows.flat()]) collectImages(cell.tokens, target);
  }
}

export function markdownImageSources(body: string): string[] {
  const result = new Set<string>();
  collectImages(marked.lexer(body, { gfm: true }), result);
  if (result.size > 40) throw new Error("一篇笔记最多插入 40 张图片。请拆分为多篇笔记。");
  return [...result];
}

type InlinePiece = { inline: Inline[] } | { image: Tokens.Image; link?: string };

/** Keep inline emphasis and links while letting an image occupy a PDF block. */
function inlinePieces(tokens: Token[], inherited: Record<string, unknown> = {}): InlinePiece[] {
  const result: InlinePiece[] = [];
  for (const token of tokens) {
    if (token.type === "image") {
      result.push({
        image: token as Tokens.Image,
        ...(typeof inherited.link === "string" ? { link: inherited.link } : {}),
      });
      continue;
    }
    if (token.type === "html") continue;
    const nested = (token as Token & { tokens?: Token[] }).tokens;
    if (nested) {
      const style = { ...inherited };
      if (token.type === "strong") style.bold = true;
      if (token.type === "em") Object.assign(style, { italics: true, color: "#49645a" });
      if (token.type === "del") style.decoration = "lineThrough";
      if (token.type === "link") {
        const link = safeLink(token.href);
        if (link) Object.assign(style, { link, color: "#27694e", decoration: "underline" });
      }
      result.push(...inlinePieces(nested, style));
    } else result.push({ inline: tokenInline([token], "", inherited) });
  }
  return result;
}

function paragraphNodes(tokens: Token[] | undefined, text: string, images: Map<string, string>, style: PdfNode = {}, maxWidth = bodyWidth - 28): PdfNode[] {
  if (!tokens?.length) {
    return [{ text: tokenInline(tokens, text), margin: [0, 0, 0, 9], ...style }];
  }
  const result: PdfNode[] = [];
  let segment: Inline[] = [];
  const flush = () => {
    if (segment.length) {
      result.push({ text: segment, margin: [0, 0, 0, 9], ...style });
      segment = [];
    }
  };
  for (const piece of inlinePieces(tokens)) {
    if ("inline" in piece) { segment.push(...piece.inline); continue; }
    flush();
    const token = piece.image;
    const src = images.get(token.href);
    if (!src) throw new Error("笔记图片尚未就绪，请稍后重试。");
    result.push({
      stack: [
        { image: src, fit: [Math.max(35, maxWidth), Math.min(490, maxWidth * 1.5)], alignment: "center", margin: [0, 2, 0, 4], ...(piece.link ? { link: piece.link } : {}) },
        ...(token.text ? [{ text: decodeEntities(token.text), alignment: "center", fontSize: 8.5, color: "#738078", margin: [0, 2, 0, 0] }] : []),
      ],
      margin: [0, 4, 0, 14],
      unbreakable: true,
    });
  }
  flush();
  return result;
}

function blockNodes(tokens: Token[], images: Map<string, string>, depth = 0): PdfNode[] {
  const result: PdfNode[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case "space":
      case "def":
      case "html":
        break;
      case "heading":
        result.push(...paragraphNodes(token.tokens, token.text, images, {
          fontSize: [22, 18, 15, 12.5, 11.5, 11][token.depth - 1] ?? 11,
          bold: true,
          headlineLevel: token.depth,
          color: "#1d4638",
          margin: [0, token.depth === 1 ? 15 : 11, 0, 8],
        }));
        break;
      case "paragraph":
      case "text": {
        const item = token as Token & { tokens?: Token[]; text: string };
        result.push(...paragraphNodes(item.tokens, item.text, images, {}, bodyWidth - 28 - depth * 24));
        break;
      }
      case "blockquote":
        result.push({
          table: { widths: ["*"], body: [[{ stack: blockNodes(token.tokens || [], images, depth + 1), margin: [10, 6, 10, 1], color: "#4e6259" }]] },
          layout: {
            hLineWidth: () => 0,
            vLineWidth: (i: number) => i === 0 ? 2 : 0,
            vLineColor: () => "#99b5a8",
            fillColor: "#f1f5f2",
          },
          margin: [0, 3, 0, 12],
        });
        break;
      case "code":
        result.push({
          table: { widths: ["*"], body: [[{
            text: token.text || " ",
            fontSize: 9,
            lineHeight: 1.3,
            color: "#33463d",
            margin: [9, 8, 9, 8],
            preserveLeadingSpaces: true,
          }]] },
          layout: {
            hLineWidth: () => 0, vLineWidth: () => 0,
            fillColor: "#f2f4f2",
          },
          margin: [0, 2, 0, 12],
        });
        break;
      case "list": {
        const list = token as Tokens.List;
        const items = list.items.map(item => {
          const stack = blockNodes(item.tokens, images, depth + 1);
          if (item.task && Array.isArray(stack[0]?.text)) stack[0].text.unshift({ text: item.checked ? "[x] " : "[ ] ", bold: true });
          return { stack };
        });
        result.push({
          [token.ordered ? "ol" : "ul"]: items,
          ...(token.ordered && typeof token.start === "number" ? { start: token.start } : {}),
          margin: [depth ? 4 : 2, 0, 0, 8],
        });
        break;
      }
      case "hr":
        result.push({ canvas: [{ type: "line", x1: 0, y1: 0, x2: bodyWidth - depth * 20, y2: 0, lineWidth: 0.7, lineColor: "#d8e1db" }], margin: [0, 7, 0, 14] });
        break;
      case "table": {
        const table = token as Tokens.Table;
        const cells = (row: Tokens.TableCell[], header: boolean) => row.map((cell, index) => ({
          stack: paragraphNodes(cell.tokens, cell.text, images, { margin: [0, 0, 0, 0] }, (bodyWidth - 28 - depth * 24) / table.header.length - 18),
          alignment: table.align[index] || "left",
          bold: header,
          fillColor: header ? "#eaf1ec" : undefined,
          margin: [5, 6, 5, 6],
        }));
        result.push({
          table: { headerRows: 1, widths: table.header.map(() => "*"), body: [cells(table.header, true), ...table.rows.map(row => cells(row, false))] },
          layout: {
            hLineWidth: () => 0.6, vLineWidth: () => 0.6,
            hLineColor: () => "#dce4de", vLineColor: () => "#dce4de",
          },
          fontSize: 9,
          margin: [0, 3, 0, 13],
        });
        break;
      }
      default: {
        const item = token as Token & { tokens?: Token[]; text?: string };
        if (item.tokens) result.push(...blockNodes(item.tokens, images, depth));
        else if (item.text) result.push({ text: item.text, margin: [0, 0, 0, 9] });
      }
    }
  }
  return result;
}

/** The document definition is also exported for deterministic rendering tests. */
export async function buildMarkdownPdfDefinition(
  input: MarkdownPdfInput,
  resolveImage: PdfImageResolver = loadNoteImage,
): Promise<TDocumentDefinitions> {
  if (input.body.length > 50000) throw new Error("笔记超过 50,000 字，请拆分后再导出。");
  const tokens = marked.lexer(input.body, { gfm: true });
  const urls = new Set<string>();
  collectImages(tokens, urls);
  if (urls.size > 40) throw new Error("一篇笔记最多插入 40 张图片。请拆分为多篇笔记。");
  const images = new Map<string, string>();
  for (const url of urls) images.set(url, await resolveImage(url));
  const nodes = blockNodes(tokens, images);
  return {
    pageSize: "A4",
    pageMargins: [48, 52, 48, 48],
    info: { title: input.title || "未命名笔记", author: "知习 · USM Study Studio", subject: input.courseLabel, creator: "知习 Markdown 笔记" },
    defaultStyle: { font: "NotoSansSC", fontSize: 10.5, lineHeight: 1.45, color: "#28392f" },
    pageBreakBefore: (currentNode, followingNodesOnPage, nodesOnNextPage) => Boolean(currentNode.headlineLevel && followingNodesOnPage.length === 0 && nodesOnNextPage.length > 0),
    content: [
      { text: input.courseLabel, color: "#6e8175", fontSize: 9, margin: [0, 0, 0, 8] },
      { text: input.title || "未命名笔记", fontSize: 23, bold: true, color: "#163e2e", margin: [0, 0, 0, 19] },
      ...(nodes.length ? nodes : [{ text: "从左侧开始写下你的学习笔记。", color: "#9aa59e", margin: [0, 10, 0, 0] }]),
    ] as unknown as Content[],
    footer: (currentPage, pageCount) => ({
      columns: [
        { text: "知习 · " + input.courseLabel, color: "#8a978e", fontSize: 8 },
        { text: String(currentPage) + " / " + String(pageCount), color: "#8a978e", fontSize: 8, alignment: "right" },
      ],
      margin: [48, 15, 48, 0],
    }),
  };
}

function arrayBufferBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32768) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
  return btoa(chunks.join(""));
}

async function loadNoteImage(url: string): Promise<string> {
  if (!isNoteImageUrl(url)) throw new Error("只能使用通过“上传图片”加入的图片。");
  let response: Response;
  try { response = await fetch(url, { credentials: "same-origin", redirect: "error" }); }
  catch { throw new Error("图片加载失败，请检查网络后重新生成 PDF。"); }
  if (!response.ok) throw new Error(response.status === 401 ? "登录已过期，请刷新后再生成 PDF。" : "有一张图片无法读取，请重新上传这张图片。");
  const blob = await response.blob();
  if (blob.size > 8 * 1024 * 1024) throw new Error("图片过大，请压缩到 8 MB 以内再上传。");
  if (blob.type === "image/png" || blob.type === "image/jpeg") return "data:" + blob.type + ";base64," + arrayBufferBase64(await blob.arrayBuffer());
  if (!["image/webp", "image/gif"].includes(blob.type)) throw new Error("图片格式不支持，请上传 PNG、JPEG 或 WebP。");
  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width * bitmap.height > 40_000_000) throw new Error("图片尺寸过大，请缩小图片后重新上传。");
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("浏览器暂时无法处理图片。");
    ctx.drawImage(bitmap, 0, 0);
    return canvas.toDataURL("image/png");
  } finally { bitmap.close(); }
}

let fontVfsPromise: Promise<Record<string, string>> | undefined;
async function getFontVfs(): Promise<Record<string, string>> {
  if (!fontVfsPromise) fontVfsPromise = Promise.all(fontFiles.map(async file => {
    const response = await fetch("/fonts/" + file);
    if (!response.ok) throw new Error("PDF 中文字体加载失败，请刷新后重试。");
    return [file, arrayBufferBase64(await response.arrayBuffer())] as const;
  })).then(entries => Object.fromEntries(entries)).catch(error => { fontVfsPromise = undefined; throw error; });
  return fontVfsPromise;
}

/** Produces a searchable, selectable-text PDF locally; notes are never sent to a third-party converter. */
export async function renderMarkdownPdf(input: MarkdownPdfInput): Promise<Blob> {
  const [definition, vfs, module] = await Promise.all([
    buildMarkdownPdfDefinition(input),
    getFontVfs(),
    import("pdfmake/build/pdfmake.js"),
  ]);
  const pdfMake = module.default;
  return new Promise<Blob>((resolve, reject) => {
    try {
      const task = pdfMake.createPdf(definition, undefined, fontDictionary, vfs);
      const stream = task.getStream();
      const chunks: BlobPart[] = [];
      stream.on("data", (chunk: Uint8Array) => chunks.push(new Uint8Array(chunk)));
      stream.on("error", reject);
      stream.on("end", () => resolve(new Blob(chunks, { type: "application/pdf" })));
      stream.end();
    } catch (error) { reject(error instanceof Error ? error : new Error("PDF 排版失败：" + String(error))); }
  });
}

