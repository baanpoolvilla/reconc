import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

// Minimal PDF text extractor: pulls positioned text runs out of the KBank
// statement PDFs in data/. It handles the single feature set those files use —
// Flate-compressed content streams, CID fonts and ToUnicode bfchar/bfrange maps.

function inflateStreams(buffer) {
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
    const raw = buffer.subarray(dataStart, end);
    try {
      streams.push(inflateSync(raw).toString("latin1"));
    } catch {
      streams.push(raw.toString("latin1"));
    }
    cursor = end + 9;
  }
  return streams;
}

function parseToUnicode(source) {
  const map = new Map();
  for (const block of source.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      map.set(Number.parseInt(pair[1], 16), codeToString(pair[2]));
    }
  }
  for (const block of source.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const range of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      const from = Number.parseInt(range[1], 16);
      const to = Number.parseInt(range[2], 16);
      const target = Number.parseInt(range[3], 16);
      for (let code = from; code <= to; code += 1) {
        map.set(code, String.fromCodePoint(target + (code - from)));
      }
    }
  }
  return map;
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

function decodeRun(bytes, unicode) {
  let out = "";
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    const code = (bytes[index] << 8) | bytes[index + 1];
    out += unicode.get(code) ?? "";
  }
  return out;
}

/**
 * Returns pages of positioned text runs: [{ runs: [{ x, y, text }] }].
 * All fonts in a document share one merged ToUnicode map, which is safe here
 * because the statement PDFs subset a single typeface family per document.
 */
export function extractPdfText(path) {
  const buffer = readFileSync(path);
  const streams = inflateStreams(buffer);

  const unicode = new Map();
  for (const stream of streams) {
    if (stream.includes("beginbfchar") || stream.includes("beginbfrange")) {
      for (const [code, text] of parseToUnicode(stream)) if (!unicode.has(code)) unicode.set(code, text);
    }
  }

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
        const text = literals.map((literal) => decodeRun(unescapePdfString(literal), unicode)).join("");
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
