import { readFileSync } from "node:fs";
import { readZip } from "./zip.mjs";

const entityPattern = /&(?:lt|gt|quot|apos|amp|#\d+|#x[0-9a-fA-F]+);/g;

// OOXML เขียนได้ทั้งแบบไม่มี namespace prefix (<sheet/>) และแบบมี (<x:sheet/>)
// ทั้งสองแบบถูกต้องตามมาตรฐานเท่ากัน ขึ้นกับว่าไฟล์ถูกสร้างด้วยเครื่องมืออะไร
// การจับเฉพาะแบบแรกทำให้ไฟล์ที่ใช้ได้จริงถูกอ่านเป็น "ไม่มีชีตข้อมูล"
const NS = String.raw`(?:\w+:)?`;
const tag = (name, body) => new RegExp(body.replace(/@/g, NS + name), "g");

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
  for (const match of fragment.matchAll(tag("t", String.raw`<@(?:\s[^>]*)?>([\s\S]*?)<\/@>`))) out += decodeXml(match[1]);
  return out;
}

function readSharedStrings(entries) {
  const file = entries.get("xl/sharedStrings.xml");
  if (!file) return [];
  const xml = file.toString("utf8");
  const strings = [];
  for (const match of xml.matchAll(tag("si", String.raw`<@(?:\s[^>]*)?>([\s\S]*?)<\/@>|<@\s*\/>`))) {
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
  // ลำดับ attribute ใน XML ไม่มีความหมาย บางเครื่องมือเขียน Target ก่อน Id
  // การอ่านทั้งสองค่าจากแท็กเดียวกันแยกกัน จึงทนกับทุกลำดับ
  for (const match of relsXml.matchAll(tag("Relationship", String.raw`<@\s[^>]*?\/?>`))) {
    const id = /\bId="([^"]+)"/.exec(match[0])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(match[0])?.[1];
    if (id && target) relations.set(id, target.replace(/^\/?xl\//, "").replace(/^\.\//, ""));
  }

  const sheets = [];
  for (const match of workbookXml.matchAll(tag("sheet", String.raw`<@\s[^>]*?\/?>`))) {
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
  for (const rowMatch of xml.matchAll(tag("row", String.raw`<@(?:\s[^>]*)?>([\s\S]*?)<\/@>`))) {
    const cells = [];
    for (const cellMatch of rowMatch[1].matchAll(tag("c", String.raw`<@\s([^>]*?)\/>|<@\s([^>]*?)>([\s\S]*?)<\/@>`))) {
      const attributes = cellMatch[1] ?? cellMatch[2];
      const body = cellMatch[3] ?? "";
      const reference = /r="([A-Z]+\d+)"/.exec(attributes)?.[1];
      const type = /t="([^"]+)"/.exec(attributes)?.[1];
      const value = tag("v", String.raw`<@>([\s\S]*?)<\/@>`).exec(body)?.[1];
      const inline = tag("is", String.raw`<@>([\s\S]*?)<\/@>`).exec(body)?.[1];

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
