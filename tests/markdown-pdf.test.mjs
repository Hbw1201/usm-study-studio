import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import PdfPrinter from "pdfmake";
import { buildMarkdownPdfDefinition, isNoteImageUrl, markdownImageSources, renderMarkdownPdf } from "../lib/markdown-pdf.ts";

const imageUrl = "/api/note-images/42bd17af-00bb-46ef-a024-7ffaeae00743";
const tinyImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8S8AAAAASUVORK5CYII=";
const source = [
  "# 核心概念",
  "",
  "使用 **粗体**、*强调*、~~修订~~ 和 \`const x = 1\` 记录知识。",
  "",
  "> 用自己的话解释一次。",
  "",
  "1. 第一步",
  "2. 第二步",
  "",
  "- 重点",
  "  - 子概念",
  "- [x] 已理解",
  "",
  "| 概念 | 解释 |",
  "| --- | --- |",
  "| Markdown | 轻量标记语言 |",
  "",
  "\`\`\`js",
  "const message = '中文 & English';",
  "console.log(message);",
  "\`\`\`",
  "",
  "![自己的示意图](" + imageUrl + ")",
  "",
  "[课程链接](https://elearning.usm.my/)",
].join("\n");

test("notes use only authenticated uploaded image paths", () => {
  assert.equal(isNoteImageUrl(imageUrl), true);
  assert.equal(isNoteImageUrl("https://example.com/test.png"), false);
  assert.equal(isNoteImageUrl("/api/note-images/../workspace"), false);
  assert.equal(isNoteImageUrl(imageUrl + "?other=yes"), false);
  assert.deepEqual(markdownImageSources(source), [imageUrl]);
  assert.throws(() => markdownImageSources("![bad](javascript:alert(1))"), /上传图片/);
});

test("PDF keeps semantic content and uses uploaded images", async () => {
  const requested = [];
  const definition = await buildMarkdownPdfDefinition({ title: "第一周笔记", body: source, courseLabel: "CMT322W · Web Engineering" }, async url => {
    requested.push(url);
    return tinyImage;
  });
  assert.deepEqual(requested, [imageUrl]);
  assert.equal(definition.pageSize, "A4");
  assert.equal(definition.defaultStyle.font, "NotoSansSC");
  const content = JSON.stringify(definition.content);
  assert.match(content, /核心概念/);
  assert.match(content, /"bold":true/);
  assert.match(content, /"headerRows":1/);
  assert.match(content, /data:image\/png/);
  assert.match(content, /"ol":/);
  assert.match(content, /"ul":/);
  assert.match(content, /https:\/\/elearning.usm.my/);
});

test("untrusted HTML and unsafe links are never emitted as active content", async () => {
  const definition = await buildMarkdownPdfDefinition({
    title: "安全笔记",
    courseLabel: "CAT402W",
    body: '<script>alert("x")</script>\n\n[按钮](javascript:alert(1))\n\n正常 &amp; 内容',
  });
  const content = JSON.stringify(definition.content);
  assert.doesNotMatch(content, /script|javascript:|alert/);
  assert.match(content, /正常 & 内容/);
});

test("image failures remain visible instead of exporting an incomplete note", async () => {
  await assert.rejects(
    buildMarkdownPdfDefinition({ title: "图", courseLabel: "CPC357W", body: source }, async () => { throw new Error("图片无法读取"); }),
    /图片无法读取/,
  );
});

test("emphasized and linked Markdown images remain images with surrounding formatting", async () => {
  let imageReads = 0;
  const definition = await buildMarkdownPdfDefinition({
    title: "嵌套图片",
    courseLabel: "CPC357W",
    body: "**重点 ![手绘图](" + imageUrl + ") 解释**\n\n[![可点击的图](" + imageUrl + ")](https://elearning.usm.my/)",
  }, async () => { imageReads++; return tinyImage; });
  const found = [];
  const visit = value => {
    if (!value || typeof value !== "object") return;
    if (value.image) found.push(value);
    for (const child of Object.values(value)) if (typeof child === "object") visit(child);
  };
  visit(definition.content);
  assert.equal(imageReads, 1, "reused image is fetched once");
  assert.equal(found.length, 2, "both nested images retain actual PDF image nodes");
  assert.equal(found[1].link, "https://elearning.usm.my/");
  const content = JSON.stringify(definition.content);
  assert.match(content, /"text":"重点 ","bold":true/);
  assert.match(content, /"text":" 解释","bold":true/);
});

test("CJK fonts produce a real multi-page PDF with tables and images", async () => {
  const definition = await buildMarkdownPdfDefinition({
    title: "Markdown 与 PDF 验证",
    courseLabel: "CMT322W · Web Engineering",
    body: source + "\n\n" + Array.from({ length: 30 }, (_, n) => "## 复习 " + (n + 1) + "\n\n" + "中文与 English 文本用于检查换行、分页与可选择文字。".repeat(4)).join("\n\n"),
  }, async () => tinyImage);
  const regular = path.resolve("public/fonts/NotoSansSC-Regular.otf");
  const bold = path.resolve("public/fonts/NotoSansSC-Bold.otf");
  const printer = new PdfPrinter({ NotoSansSC: { normal: regular, bold, italics: regular, bolditalics: bold } });
  const bytes = await new Promise((resolve, reject) => {
    const doc = printer.createPdfKitDocument(definition);
    const chunks = [];
    doc.on("data", chunk => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.end();
  });
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  assert.ok(bytes.length > 10000);
  assert.ok((bytes.toString("latin1").match(/\/Type \/Page\b/g) || []).length > 1);
  await fs.mkdir("outputs", { recursive: true });
  await fs.writeFile("outputs/markdown-pdf-check.pdf", bytes);
});

test("browser bundle returns a PDF Blob with embedded CJK fonts", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (String(url).startsWith("/fonts/")) return new Response(await fs.readFile("public" + url));
    if (url === imageUrl) return new Response(Buffer.from(tinyImage.split(",")[1], "base64"), { headers: { "Content-Type": "image/png" } });
    throw new Error("Unexpected fetch: " + url);
  };
  try {
    const blob = await renderMarkdownPdf({ title: "浏览器 PDF", body: source, courseLabel: "CMT322W" });
    assert.equal(blob.type, "application/pdf");
    assert.equal(Buffer.from(await blob.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
  } finally { globalThis.fetch = originalFetch; }
});

