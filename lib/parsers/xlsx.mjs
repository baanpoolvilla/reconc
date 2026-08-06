import { readFileSync } from "node:fs";
import { readZip } from "./zip.mjs";

const entityPattern = /&(?:lt|gt|quot|apos|amp|#\d+|#x[0-9a-fA-F]+);/g;

function decodeXml(value) {
  return value.replace(entityPattern, (entity) => {
    switch (entity) {
      case "&lt;": return "<";
      case "&gt;": return ">";
      case "&quot;": return '"';
      case "&apos;": return "'";
      case "&amp;": return "&";
      default:
        return entity[2] === "x" || entity[2] === "X"
          ? String.fromCodePoint(Number.parseInt(entity.slice(3, -1), 16))
          : String.fromCodePoint(Number(entity.slice(2, -1)));
    }
  });
}

function textOf(fragment) {
  let out = "";
  for (const match of fragment.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += decodeXml(match[1]);
  return out;
}

function readSharedStrings(entries) {
  const file = entries.get("xl/sharedStrings.xml");
  if (!file) return [];
  const xml = file.toString("utf8");
  const strings = [];
  for (const match of xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>|<si\s*\/>/g)) {
    strings.push(match[1] === undefined ? "" : textOf(match[1]));
  }
  return strings;
}

function columnIndex(reference) {
  const letters = /^[A-Z]+/.exec(reference)?.[0] ?? "A";
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

/** Reads every sheet of an .xlsx file into arrays of trimmed string cells. */
export function readWorkbook(path) {
  return readWorkbookBuffer(readFileSync(path));
}

/** Same, for a workbook already in memory — an upload, for instance. */
export function readWorkbookBuffer(buffer) {
  const entries = readZip(buffer);
  const shared = readSharedStrings(entries);
  const workbookXml = entries.get("xl/workbook.xml").toString("utf8");
  const relsXml = entries.get("xl/_rels/workbook.xml.rels").toString("utf8");

  const relations = new Map();
  for (const match of relsXml.matchAll(/<Relationship\s[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    relations.set(match[1], match[2].replace(/^\/?xl\//, "").replace(/^\.\//, ""));
  }

  const sheets = [];
  for (const match of workbookXml.matchAll(/<sheet\s[^>]*\/>/g)) {
    const name = decodeXml(/name="([^"]*)"/.exec(match[0])?.[1] ?? "");
    const relationId = /r:id="([^"]+)"/.exec(match[0])?.[1];
    const target = relations.get(relationId);
    const entry = entries.get(`xl/${target}`);
    if (!entry) continue;
    sheets.push({ name, rows: readSheet(entry.toString("utf8"), shared) });
  }
  return sheets;
}

function readSheet(xml, shared) {
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\s([^>]*?)\/>|<c\s([^>]*?)>([\s\S]*?)<\/c>/g)) {
      const attributes = cellMatch[1] ?? cellMatch[2];
      const body = cellMatch[3] ?? "";
      const reference = /r="([A-Z]+\d+)"/.exec(attributes)?.[1];
      const type = /t="([^"]+)"/.exec(attributes)?.[1];
      const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      const inline = /<is>([\s\S]*?)<\/is>/.exec(body)?.[1];

      let text = "";
      if (type === "s" && value !== undefined) text = shared[Number(value)] ?? "";
      else if (type === "inlineStr" && inline !== undefined) text = textOf(inline);
      else if (value !== undefined) text = decodeXml(value);

      const index = reference ? columnIndex(reference) : cells.length;
      cells[index] = text.trim();
    }
    rows.push(Array.from(cells, (cell) => cell ?? ""));
  }
  return rows;
}
