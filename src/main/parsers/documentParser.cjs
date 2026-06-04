const crypto = require('node:crypto');
const mammoth = require('mammoth');
let pdfParse = null;
try {
  pdfParse = require('pdf-parse');
} catch {
  pdfParse = null;
}

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.csv', '.json', '.html', '.htm']);
const DOCX_EXTENSIONS = new Set(['.docx']);
const PDF_EXTENSIONS = new Set(['.pdf']);

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .trim();
}

function extensionOf(filename = '') {
  const match = String(filename).toLowerCase().match(/(\.[a-z0-9]+)$/);
  return match ? match[1] : '';
}

function stripHtml(value) {
  return normalizeText(value)
    .replace(/<script[\s\S]*?<\/script>/gi, '\n')
    .replace(/<style[\s\S]*?<\/style>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function formatJsonText(value) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return normalizeText(value);
  }
}

function parseTextByType(text, filename, contentType) {
  const ext = extensionOf(filename);
  if (ext === '.html' || ext === '.htm' || /html/i.test(String(contentType || ''))) {
    return stripHtml(text);
  }
  if (ext === '.json' || /json/i.test(String(contentType || ''))) {
    return formatJsonText(text);
  }
  return normalizeText(text);
}

function isTextLike(filename, contentType) {
  const ext = extensionOf(filename);
  return TEXT_EXTENSIONS.has(ext)
    || /^text\//i.test(String(contentType || ''))
    || /json|csv|html|markdown/i.test(String(contentType || ''));
}

function isDocxLike(filename, contentType) {
  const ext = extensionOf(filename);
  return DOCX_EXTENSIONS.has(ext)
    || /officedocument\.wordprocessingml\.document/i.test(String(contentType || ''));
}

function isPdfLike(filename, contentType) {
  const ext = extensionOf(filename);
  return PDF_EXTENSIONS.has(ext) || /pdf/i.test(String(contentType || ''));
}

function decodeBase64Payload(contentBase64 = '') {
  const rawBase64 = String(contentBase64 || '').replace(/^data:[^,]+,/, '');
  return Buffer.from(rawBase64, 'base64');
}

function failedParsedAsset({ id, filename, contentType, message, timestamp }) {
  return {
    asset: {
      id,
      draft_id: '',
      filename,
      content_type: contentType,
      file_path: `draft://${filename}`,
      status: 'failed',
      error_message: message,
      created_at: timestamp,
      updated_at: timestamp,
    },
    document: {
      id,
      filename,
      content_type: contentType,
      text: '',
      text_length: 0,
      status: 'failed',
      error_message: message,
    },
  };
}

function successfulParsedAsset({ id, filename, contentType, text, timestamp }) {
  return {
    asset: {
      id,
      draft_id: '',
      filename,
      content_type: contentType,
      file_path: `draft://${filename}`,
      status: 'parsed',
      error_message: null,
      created_at: timestamp,
      updated_at: timestamp,
    },
    document: {
      id,
      filename,
      content_type: contentType,
      text,
      text_length: text.length,
      status: 'parsed',
      error_message: null,
    },
  };
}

async function parseAsset(asset = {}) {
  const timestamp = nowIso();
  const id = crypto.randomUUID();
  const filename = normalizeText(asset.filename) || 'untitled.txt';
  const contentType = asset.content_type || null;

  try {
    const buffer = decodeBase64Payload(asset.content_base64);
    let text = '';

    if (isTextLike(filename, contentType)) {
      text = parseTextByType(buffer.toString('utf8'), filename, contentType);
    } else if (isDocxLike(filename, contentType)) {
      const result = await mammoth.extractRawText({ buffer });
      text = normalizeText(result.value);
    } else if (isPdfLike(filename, contentType)) {
      if (!pdfParse) {
        return failedParsedAsset({
          id,
          filename,
          contentType,
          timestamp,
          message: 'PDF parser dependency is not installed.',
        });
      }
      const result = await pdfParse(buffer);
      text = normalizeText(result.text);
    } else {
      return failedParsedAsset({
        id,
        filename,
        contentType,
        timestamp,
        message: '当前支持 TXT、Markdown、CSV、JSON、HTML、DOCX。PDF 将在后续版本接入。',
      });
    }

    if (!text) {
      return failedParsedAsset({
        id,
        filename,
        contentType,
        timestamp,
        message: '文件内容为空，或未能从文件中提取到可用文本。',
      });
    }

    return successfulParsedAsset({ id, filename, contentType, text, timestamp });
  } catch (error) {
    return failedParsedAsset({
      id,
      filename,
      contentType,
      timestamp,
      message: error instanceof Error ? error.message : '附件解析失败。',
    });
  }
}

async function parseAssets(assets = []) {
  const parsed = [];
  for (const asset of assets) {
    parsed.push(await parseAsset(asset));
  }
  return parsed;
}

module.exports = {
  normalizeText,
  parseAssets,
  parseTextByType,
};
