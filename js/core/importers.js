// ActoMind – importing script text from TXT, DOCX and text-based PDF files (fully offline).
import { readZip } from './zip.js';

/** Decode text bytes: UTF-8 (with BOM detection), UTF-16, fallback Windows-1250 (Polish). */
export function decodeText(u8) {
  if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder('utf-16le').decode(u8.subarray(2));
  if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder('utf-16be').decode(u8.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(u8).replace(/^﻿/, '');
  } catch {
    try { return new TextDecoder('windows-1250').decode(u8); } catch { return new TextDecoder('iso-8859-2').decode(u8); }
  }
}

const XML_ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function decodeXmlEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return XML_ENT[e.toLowerCase()] ?? m;
  });
}

/** Extract paragraphs from WordprocessingML (word/document.xml). */
export function docxXmlToText(xml) {
  const body = xml.replace(/<w:del\b[\s\S]*?<\/w:del>/g, '');
  const paras = body.split(/<\/w:p>/);
  const out = [];
  for (const p of paras) {
    if (!/<w:p[\s>]/.test(p)) continue;
    let line = '';
    const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\b[^>]*\/>|<w:cr\/>|<w:noBreakHyphen\/>|<w:sym\b[^>]*w:char="([0-9A-Fa-f]+)"[^>]*\/>/g;
    let m;
    while ((m = re.exec(p))) {
      if (m[1] !== undefined) line += decodeXmlEntities(m[1]);
      else if (m[0].startsWith('<w:tab')) line += '\t';
      else if (m[0].startsWith('<w:br') || m[0].startsWith('<w:cr')) line += '\n';
      else if (m[0].startsWith('<w:noBreakHyphen')) line += '-';
    }
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

export async function docxToText(arrayBuffer, opts = {}) {
  const zip = await readZip(arrayBuffer, opts);
  const doc = zip.get('word/document.xml');
  if (!doc) throw new Error('DOCX: word/document.xml not found');
  const xml = new TextDecoder().decode(await doc());
  return docxXmlToText(xml);
}

let pdfjsPromise = null;
async function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('../../vendor/pdfjs/pdf.min.mjs').then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
      return lib;
    });
  }
  return pdfjsPromise;
}

/** Text of a PDF with lines reconstructed from item positions. */
export async function pdfToText(arrayBuffer, onProgress) {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer), isEvalSupported: false }).promise;
  const pages = [];
  let totalChars = 0;
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const rows = [];
    for (const it of content.items) {
      if (!('str' in it)) continue;
      const y = it.transform[5];
      const x = it.transform[4];
      const h = Math.abs(it.transform[3]) || it.height || 10;
      let row = rows.find((r) => Math.abs(r.y - y) < h * 0.5);
      if (!row) { row = { y, h, items: [] }; rows.push(row); }
      row.items.push({ x, str: it.str, w: it.width || 0 });
    }
    rows.sort((a, b) => b.y - a.y);
    const lines = [];
    let prevY = null;
    let prevH = 10;
    for (const r of rows) {
      r.items.sort((a, b) => a.x - b.x);
      let s = '';
      let lastEnd = null;
      for (const it of r.items) {
        if (lastEnd != null && it.x - lastEnd > r.h * 0.2 && !s.endsWith(' ') && !it.str.startsWith(' ')) s += ' ';
        s += it.str;
        lastEnd = it.x + it.w;
      }
      if (prevY != null && prevY - r.y > Math.max(prevH, r.h) * 1.8) lines.push('');
      lines.push(s.replace(/\s+$/, ''));
      prevY = r.y;
      prevH = r.h;
    }
    const text = lines.join('\n');
    totalChars += text.trim().length;
    pages.push(text);
    onProgress?.(n / doc.numPages);
  }
  if (totalChars < 20) {
    const e = new Error('PDF_NO_TEXT');
    e.code = 'PDF_NO_TEXT';
    throw e;
  }
  return pages.join('\n\n');
}

/** Import any supported file → text */
export async function fileToText(file, onProgress) {
  const name = (file.name || '').toLowerCase();
  const ab = await file.arrayBuffer();
  if (name.endsWith('.docx')) return docxToText(ab);
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return pdfToText(ab, onProgress);
  if (name.endsWith('.json')) return null;
  return decodeText(new Uint8Array(ab));
}
