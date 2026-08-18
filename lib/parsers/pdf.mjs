import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

// Minimal PDF text extractor: pulls positioned text runs out of KBank statement
// PDFs. It handles CID fonts, ToUnicode bfchar/bfrange maps, and content streams
// encoded with the filters those documents use.
//
// A stream names its encoding in /Filter, and that may be a chain applied in
// order — /Filter [ /ASCII85Decode /FlateDecode ] means ASCII85 first, then
// Flate. Assuming a bare Flate silently skipped any stream that used a chain,
// which read as "this PDF has no text in it" for a file that was perfectly fine.

/** ASCII85 → ไบต์ ตามที่ PDF spec นิยามไว้ (รวมย่อ z = ศูนย์สี่ไบต์) */
function decodeAscii85(buffer) {
  const text = buffer.toString("latin1").replace(/\s/g, "");
  const body = text.slice(text.startsWith("<~") ? 2 : 0, text.includes("~>") ? text.indexOf("~>") : undefined);
  const out = [];
  let group = [];

  const flush = (size) => {
    while (group.length < 5) group.push(84); // เติม 'u' ให้ครบกลุ่มก่อนถอด
    let value = 0;
    for (const digit of group) value = value * 85 + digit;
    const bytes = [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
    for (let index = 0; index < size; index += 1) out.push(bytes[index]);
    group = [];
  };

  for (const character of body) {
    if (character === "z" && group.length === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    const digit = character.charCodeAt(0) - 33;
    if (digit < 0 || digit > 84) continue;
    group.push(digit);
    if (group.length === 5) flush(4);
  }
  if (group.length > 1) flush(group.length - 1);

  return Buffer.from(out);
}

const DECODERS = {
  ASCII85Decode: decodeAscii85,
  A85: decodeAscii85,
  ASCIIHexDecode: (buffer) => {
    const hex = buffer.toString("latin1").replace(/[^0-9a-fA-F>]/g, "").split(">")[0];
    return Buffer.from(hex.length % 2 ? `${hex}0` : hex, "hex");
  },
  FlateDecode: inflateSync,
  Fl: inflateSync,
};

/** ชื่อ filter ตามลำดับที่ต้องถอด อ่านจาก dictionary ที่อยู่ก่อนคำว่า stream */
function filtersOf(dictionary) {
  const declared = /\/Filter\s*(\[[^\]]*\]|\/\w+)/.exec(dictionary)?.[1] ?? "";
  return [...declared.matchAll(/\/(\w+)/g)].map((match) => match[1]);
}

function decodeStreams(buffer) {
  const streams = [];
  let cursor = 0;
  while (true) {
    const start = buffer.indexOf("stream", cursor);
    if (start < 0) break;
    let dataStart = start + 6;
    if (buffer[dataStart] === 0x0d) dataStart += 1;
    if (buffer[dataStart] === 0x0a) dataStart += 1;
    const end = buffer.indexOf("endstream", dataStart);
    if (end < 0) break;

    const dictionaryStart = buffer.lastIndexOf("<<", start);
    const dictionary = dictionaryStart < 0 ? "" : buffer.subarray(dictionaryStart, start).toString("latin1");

    let data = buffer.subarray(dataStart, end);
    for (const filter of filtersOf(dictionary)) {
      const decode = DECODERS[filter];
      if (!decode) break; // filter ที่ยังไม่รองรับ (เช่น DCTDecode ของภาพ) ปล่อยไว้
      try {
        data = decode(data);
      } catch {
        break;
      }
    }
    streams.push(data.toString("latin1"));
    cursor = end + 9;
  }
  return streams;
}

/**
 * ToUnicode CMap → แผนที่รหัสตัวอักษร พร้อมความกว้างของรหัสที่เอกสารนี้ใช้
 *
 * รหัสตัวอักษรกว้างกี่ไบต์เป็นเรื่องของแต่ละฟอนต์ K BIZ ใช้ 2 ไบต์ (<0001>)
 * เครื่องมืออื่นที่ subset ฟอนต์เล็กกว่าใช้ 1 ไบต์ (<01>) การเดาว่าเป็น 2 ไบต์
 * เสมอทำให้ไฟล์แบบหลังถอดออกมาเป็นข้อความว่าง — เหมือนไม่มีข้อความในไฟล์เลย
 */
function parseToUnicode(source) {
  const map = new Map();
  const widths = new Set();

  // codespacerange บอกความกว้างไว้ตรง ๆ ถ้าเอกสารประกาศไว้
  for (const block of source.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g)) {
    for (const pair of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      widths.add(Math.ceil(pair[1].length / 2));
    }
  }
  for (const block of source.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      widths.add(Math.ceil(pair[1].length / 2));
      map.set(Number.parseInt(pair[1], 16), codeToString(pair[2]));
    }
  }
  for (const block of source.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const range of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      widths.add(Math.ceil(range[1].length / 2));
      const from = Number.parseInt(range[1], 16);
      const to = Number.parseInt(range[2], 16);
      const target = Number.parseInt(range[3], 16);
      for (let code = from; code <= to; code += 1) {
        map.set(code, String.fromCodePoint(target + (code - from)));
      }
    }
  }
  return { map, widths };
}

function codeToString(hex) {
  let out = "";
  for (let index = 0; index < hex.length; index += 4) {
    out += String.fromCharCode(Number.parseInt(hex.slice(index, index + 4).padEnd(4, "0"), 16));
  }
  return out;
}

function unescapePdfString(source) {
  const bytes = [];
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char !== "\\") {
      bytes.push(source.charCodeAt(index));
      continue;
    }
    const next = source[index + 1];
    const octal = /^[0-7]{1,3}/.exec(source.slice(index + 1, index + 4))?.[0];
    if (octal) {
      bytes.push(Number.parseInt(octal, 8));
      index += octal.length;
    } else {
      const escapes = { n: 10, r: 13, t: 9, b: 8, f: 12 };
      bytes.push(escapes[next] ?? source.charCodeAt(index + 1));
      index += 1;
    }
  }
  return bytes;
}

function decodeRun(bytes, unicode, width) {
  let out = "";
  if (width === 1) {
    for (const byte of bytes) out += unicode.get(byte) ?? "";
    return out;
  }
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    out += unicode.get((bytes[index] << 8) | bytes[index + 1]) ?? "";
  }
  return out;
}

/**
 * Returns pages of positioned text runs: [{ runs: [{ x, y, text }] }].
 * All fonts in a document share one merged ToUnicode map, which is safe here
 * because the statement PDFs subset a single typeface family per document.
 */
export function extractPdfText(path) {
  return extractPdfTextFromBuffer(readFileSync(path));
}

/** Same, for a PDF already in memory — an upload, for instance. */
export function extractPdfTextFromBuffer(buffer) {
  const streams = decodeStreams(buffer);

  const unicode = new Map();
  const widths = new Set();
  for (const stream of streams) {
    if (stream.includes("beginbfchar") || stream.includes("beginbfrange")) {
      const cmap = parseToUnicode(stream);
      for (const [code, text] of cmap.map) if (!unicode.has(code)) unicode.set(code, text);
      for (const width of cmap.widths) widths.add(width);
    }
  }
  // ฟอนต์ในเอกสารเดียวกันใช้ความกว้างเดียวกัน ถ้าปนกันจริงให้ยึด 2 ไบต์ตามเดิม
  const codeWidth = widths.size === 1 ? [...widths][0] : 2;

  const pages = [];
  for (const stream of streams) {
    if (!/\bTj\b|\bTJ\b/.test(stream)) continue;
    const runs = [];
    let x = 0;
    let y = 0;
    const tokenPattern = /(-?[\d.]+)\s+(-?[\d.]+)\s+Td|1\s+0\s+0\s+1\s+(-?[\d.]+)\s+(-?[\d.]+)\s+Tm|\(((?:\\.|[^()\\])*)\)\s*Tj|\[((?:\\.|[^[\]\\])*)\]\s*TJ/g;
    for (const token of stream.matchAll(tokenPattern)) {
      if (token[3] !== undefined) {
        x = Number(token[3]);
        y = Number(token[4]);
      } else if (token[1] !== undefined) {
        x += Number(token[1]);
        y += Number(token[2]);
      } else {
        const body = token[5] ?? token[6] ?? "";
        const literals = token[5] !== undefined
          ? [token[5]]
          : Array.from(body.matchAll(/\(((?:\\.|[^()\\])*)\)/g), (m) => m[1]);
        const text = literals.map((literal) => decodeRun(unescapePdfString(literal), unicode, codeWidth)).join("");
        if (text.trim()) runs.push({ x, y, text });
      }
    }
    if (runs.length) pages.push({ runs });
  }
  return pages;
}

/** Groups a page's runs into visual lines (same baseline), ordered top-to-bottom. */
export function groupIntoLines(page, tolerance = 2.5) {
  const lines = [];
  for (const run of [...page.runs].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const line = lines.find((candidate) => Math.abs(candidate.y - run.y) <= tolerance);
    if (line) line.runs.push(run);
    else lines.push({ y: run.y, runs: [run] });
  }
  for (const line of lines) line.runs.sort((a, b) => a.x - b.x);
  return lines;
}
