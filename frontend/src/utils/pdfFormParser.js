import * as pdfjs from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const FIELD_ALIASES = {
  first_name: ['first name', 'given name', 'forename'],
  last_name: ['last name', 'surname', 'family name'],
  email: ['email', 'email address', 'e mail'],
  phone: ['phone', 'phone number', 'mobile', 'mobile number', 'telephone'],
  years_experience: ['years of experience', 'years experience', 'work experience', 'experience'],
  employment_status: ['employment status', 'work status'],
  currently_employed: ['currently employed', 'currently working', 'employed'],
};

const normalize = (value) => String(value || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

function aliasesFor(field) {
  const key = normalize(field.field_name).replace(/\s+/g, '_');
  const question = normalize(field.question)
    .replace(/^(what is|what s|how many|how long|are you|do you|please enter|enter|your)\s+/i, '')
    .replace(/[?]/g, '')
    .trim();
  return [...new Set([
    normalize(field.field_name),
    question,
    ...(FIELD_ALIASES[key] || []),
  ].filter(Boolean))];
}

function valueAfterLabel(line, aliases) {
  const normalizedLine = normalize(line);
  for (const alias of aliases) {
    const normalizedAlias = normalize(alias);
    if (!normalizedAlias || !normalizedLine.startsWith(normalizedAlias)) continue;
    const labelPattern = normalizedAlias
      .split(' ')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[\\s_:/-]+');
    const originalMatch = line.match(new RegExp(`^\\s*${labelPattern}\\s*(?:[:=|–—-]\\s*|\\s+)(.+)$`, 'i'));
    if (originalMatch?.[1]?.trim()) return originalMatch[1].trim();
    const remainder = normalizedLine.slice(normalizedAlias.length).trim();
    if (remainder && !/^(address|status|number|name)$/.test(remainder)) return remainder;
  }
  return '';
}

function fallbackForType(field, text) {
  const type = normalize(field.field_type);
  if (type === 'email') return text.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i)?.[0] || '';
  if (type === 'phone') return text.match(/(?:\+?\d[\d\s().-]{7,}\d)/)?.[0]?.trim() || '';
  if (type === 'number' || normalize(field.field_name).includes('experience')) {
    const match = text.match(/(\d+(?:\.\d+)?)\s*(?:years?|yrs?)(?:\s+of\s+experience)?/i);
    return match?.[1] || '';
  }
  if (type === 'choice' && field.options) {
    const options = String(field.options).replace(/[\[\]"']/g, '').split(/[,;|\n]+/).map((item) => item.trim()).filter(Boolean);
    const normalizedText = ` ${normalize(text)} `;
    return options.find((option) => normalizedText.includes(` ${normalize(option)} `)) || '';
  }
  return '';
}

function fullNameFromLines(lines) {
  const nameLabel = /^\s*(?:(?:full|candidate|applicant|employee)\s+)?name\s*[:=|–—-]\s*(.+)$/i;
  const labeledName = lines.map((line) => line.match(nameLabel)?.[1]?.trim()).find(Boolean);
  if (labeledName) return labeledName;

  const headingWords = new Set(['resume', 'curriculum vitae', 'cv', 'profile', 'contact', 'experience', 'education', 'skills', 'summary']);
  return lines.find((line) => {
    const cleaned = line.trim();
    const words = cleaned.split(/\s+/);
    const normalized = normalize(cleaned);
    return words.length >= 2 && words.length <= 4
      && /^[\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*){1,3}$/u.test(cleaned)
      && !headingWords.has(normalized);
  })?.trim() || '';
}

function readMarkdownTables(lines, fieldAliases) {
  const values = new Map();
  const tables = [];
  let current = [];

  const flush = () => {
    if (current.length > 1) tables.push(current);
    current = [];
  };

  for (const line of lines) {
    if (!line.includes('|')) {
      flush();
      continue;
    }
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '')
      .split('|').map((cell) => cell.trim());
    if (cells.length > 1) current.push(cells);
  }
  flush();

  for (const table of tables) {
    const header = table[0];
    const dataRows = table.slice(1).filter((row) => !row.every((cell) => /^:?-{2,}:?$/.test(cell)));
    const row = dataRows.find((candidate) => candidate.some(Boolean));
    if (!row) continue;

    for (const { field, aliases } of fieldAliases) {
      if (values.has(field.id)) continue;
      const matchingColumn = header.findIndex((cell) => {
        const normalizedHeader = normalize(cell);
        return aliases.some((alias) => {
          const normalizedAlias = normalize(alias);
          return normalizedHeader === normalizedAlias
            || normalizedHeader.startsWith(`${normalizedAlias} `)
            || normalizedHeader.endsWith(` ${normalizedAlias}`);
        });
      });
      const value = matchingColumn >= 0 ? String(row[matchingColumn] || '').trim() : '';
      if (value && !/^:?-{2,}:?$/.test(value)) values.set(field.id, value);
    }
  }
  return values;
}

export function parsePdfOcrTextForFields(text, fields) {
  if (!String(text || '').trim()) throw new Error('OCR did not find readable text in this PDF.');
  return parseExtractedText(String(text), fields);
}

function parseExtractedText(text, fields) {
  const pageLines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const fullName = fullNameFromLines(pageLines);
  const nameParts = fullName.split(/\s+/).filter(Boolean);
  const fieldAliases = fields.map((field) => ({ field, aliases: aliasesFor(field).sort((a, b) => b.length - a.length) }));
  const tableValues = readMarkdownTables(pageLines, fieldAliases);
  const hasFirstName = fieldAliases.some(({ field }) => normalize(field.field_name) === 'first name');
  const hasLastName = fieldAliases.some(({ field }) => normalize(field.field_name) === 'last name');

  return fieldAliases.map(({ field, aliases }) => {
    const labeledValue = pageLines.map((line) => valueAfterLabel(line, aliases)).find(Boolean);
    let value = labeledValue || tableValues.get(field.id) || fallbackForType(field, text);
    const fieldName = normalize(field.field_name);
    if (!value && fullName && (fieldName === 'first name' || fieldName === 'last name')) {
      if (fieldName === 'first name' && hasFirstName) value = nameParts[0] || '';
      if (fieldName === 'last name' && hasLastName) value = nameParts.slice(1).join(' ');
    }
    return { field_id: field.id, field_name: field.field_name, question: field.question, field_type: field.field_type, value };
  });
}

export async function parsePdfForFields(file, fields) {
  if (!file || (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf')) {
    throw new Error('Choose a PDF file to continue.');
  }
  if (file.size > 12 * 1024 * 1024) throw new Error('PDF files must be 12 MB or smaller.');

  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const document = await loadingTask.promise;
  const pageLines = [];
  try {
    if (document.numPages > 40) {
      throw new Error('This PDF has more than 40 pages. Please choose a shorter document.');
    }

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const rows = new Map();
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        const y = Math.round(item.transform[5]);
        const row = rows.get(y) || [];
        row.push({ x: item.transform[4], text: item.str.trim() });
        rows.set(y, row);
      }
      [...rows.entries()]
        .sort(([yA], [yB]) => yB - yA)
        .forEach(([, row]) => pageLines.push(row.sort((a, b) => a.x - b.x).map((part) => part.text).join(' ')));
    }
  } finally {
    await loadingTask.destroy();
  }

  const text = pageLines.join('\n');
  if (!text.trim()) {
    throw new Error('This PDF has no selectable text; OCR is needed.');
  }
  const distinctEmails = new Set(
    [...text.matchAll(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi)].map(([email]) => email.toLowerCase()),
  );
  if (distinctEmails.size > 1) {
    throw new Error('This PDF contains multiple people. An admin can import everyone from Management Console > Bulk PDF Fill.');
  }
  return parseExtractedText(text, fields);
}
