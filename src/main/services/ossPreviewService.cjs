const crypto = require('node:crypto');

function text(value) {
  return String(value ?? '').trim();
}

function requiredEnv(name) {
  const value = text(process.env[name]);
  if (!value) {
    throw new Error(`缺少 ${name}，无法上传稿件预览页。`);
  }
  return value;
}

function optionalEnv(name) {
  return text(process.env[name]);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function renderContentHtml(content) {
  const lines = String(content || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [];
  let list = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list.length) return;
    blocks.push(`<ul>${list.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</ul>`);
    list = [];
  };

  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      return;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(heading[1].length + 1, 4);
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      return;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      list.push(bullet[1]);
      return;
    }
    flushList();
    paragraph.push(line);
  });

  flushParagraph();
  flushList();
  return blocks.join('\n') || '<p></p>';
}

function stripTitleFromContent(content, title) {
  if (!title || !content) return content;
  const normalizedTitle = String(title).trim().toLowerCase();
  const lines = String(content).replace(/\r\n/g, '\n').split('\n');
  // 找到第一个非空行，如果是标题且和稿件标题一致就跳过
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    const match = line.match(/^#{1,6}\s+(.+)$/);
    if (match && match[1].trim().toLowerCase() === normalizedTitle) {
      lines.splice(i, 1);
      return lines.join('\n');
    }
    break; // 第一个非空行不是标题或不匹配，不处理
  }
  return content;
}

function renderPreviewHtml({ title, content, owner }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title || '稿件预览')}</title>
  <style>
    body { margin: 0; background: #f7f7f5; color: #202020; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { max-width: 820px; margin: 0 auto; padding: 48px 24px 72px; background: #fff; min-height: 100vh; box-sizing: border-box; }
    h1 { margin: 0 0 12px; font-size: 30px; line-height: 1.25; }
    .meta { margin-bottom: 28px; color: #666; font-size: 13px; }
    article { font-size: 16px; line-height: 1.85; }
    article h2, article h3, article h4 { margin: 28px 0 12px; line-height: 1.35; }
    article p { margin: 0 0 16px; }
    article ul { margin: 0 0 16px 1.2em; padding: 0; }
    article li { margin: 0 0 8px; }
    article code { padding: 1px 4px; border-radius: 4px; background: #f0f0ee; }
    html.dark body { background: #121212; color: #e0e0e0; }
    html.dark main { background: #1e1e1e; }
    html.dark .meta { color: #999; }
    html.dark article code { background: #2b2b2b; }
    @media (prefers-color-scheme: dark) {
      body { background: #121212; color: #e0e0e0; }
      main { background: #1e1e1e; }
      .meta { color: #999; }
      article code { background: #2b2b2b; }
    }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title || '未命名稿件')}</h1>
    <div class="meta">${escapeHtml(owner || '')}</div>
    <article>${renderContentHtml(stripTitleFromContent(content || '', title))}</article>
  </main>
  <script>
    (function() {
      function syncTheme() {
        var dark = window.parent && window.parent.document && window.parent.document.documentElement.classList.contains('dark');
        document.documentElement.classList.toggle('dark', !!dark);
      }
      syncTheme();
      try { new MutationObserver(syncTheme).observe(window.parent.document.documentElement, { attributes: true, attributeFilter: ['class'] }); } catch(e) {}
    })();
  </script>
</body>
</html>`;
}

function hmac(key, data, encoding) {
  return crypto.createHmac('sha1', key).update(data).digest(encoding);
}

function buildOssAuthorization({ method, contentMd5, contentType, date, resource, accessKeyId, accessKeySecret }) {
  const stringToSign = [method, contentMd5, contentType, date, resource].join('\n');
  return `OSS ${accessKeyId}:${hmac(accessKeySecret, stringToSign, 'base64')}`;
}

function getPreviewUrl(objectKey) {
  const publicBaseUrl = optionalEnv('ALI_OSS_PUBLIC_BASE_URL').replace(/\/+$/, '');
  if (!publicBaseUrl) {
    throw new Error('缺少 ALI_OSS_PUBLIC_BASE_URL。超级媒介需要可在线打开的公网 HTML 预览页，请配置自定义域名、CDN 或静态网站地址。');
  }
  let url;
  try {
    url = new URL(publicBaseUrl);
  } catch {
    throw new Error('ALI_OSS_PUBLIC_BASE_URL 必须是合法 URL。');
  }
  if (/\.aliyuncs\.com$/i.test(url.hostname)) {
    throw new Error('ALI_OSS_PUBLIC_BASE_URL 不能使用 OSS 原始 aliyuncs.com 域名。请配置会在线展示 HTML 的自定义域名、CDN 或静态网站地址。');
  }
  return `${publicBaseUrl}/${objectKey}`;
}

async function uploadPreview({ projectId, articleId, title, content, owner }) {
  const region = requiredEnv('ALI_OSS_REGION');
  const bucket = requiredEnv('ALI_OSS_BUCKET');
  const accessKeyId = requiredEnv('ALI_OSS_ACCESS_KEY_ID');
  const accessKeySecret = requiredEnv('ALI_OSS_ACCESS_KEY_SECRET');
  const objectKey = `geo-agent/previews/${encodeURIComponent(projectId)}/${encodeURIComponent(articleId)}.html`;
  const previewUrl = getPreviewUrl(objectKey);
  const previewHtml = renderPreviewHtml({ title, content, owner });
  const body = Buffer.from(previewHtml, 'utf8');
  const method = 'PUT';
  const contentType = 'text/html; charset=utf-8';
  const contentMd5 = crypto.createHash('md5').update(body).digest('base64');
  const date = new Date().toUTCString();
  const host = `${bucket}.${region}.aliyuncs.com`;
  const resource = `/${bucket}/${objectKey}`;
  const authorization = buildOssAuthorization({
    method,
    contentMd5,
    contentType,
    date,
    resource,
    accessKeyId,
    accessKeySecret,
  });

  const response = await fetch(`https://${host}/${objectKey}`, {
    method,
    headers: {
      Authorization: authorization,
      Date: date,
      'Content-Type': contentType,
      'Content-MD5': contentMd5,
      'Content-Disposition': 'inline',
    },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`OSS 上传失败：${response.status} ${errorText.slice(0, 200)}`);
  }

  // 上传后用 HEAD 请求验证 OSS 实际返回的 Content-Disposition，
  // 如果桶有全局 attachment 策略会覆盖对象级别设置，导致浏览器下载而非预览。
  const headDate = new Date().toUTCString();
  const headResource = `/${bucket}/${objectKey}`;
  const headAuth = buildOssAuthorization({
    method: 'HEAD',
    contentMd5: '',
    contentType: '',
    date: headDate,
    resource: headResource,
    accessKeyId,
    accessKeySecret,
  });
  const headResp = await fetch(`https://${host}/${objectKey}`, {
    method: 'HEAD',
    headers: { Authorization: headAuth, Date: headDate },
  });
  if (headResp.ok) {
    const disposition = (headResp.headers?.get?.('content-disposition') || '').toLowerCase();
    const ct = (headResp.headers?.get?.('content-type') || '').toLowerCase();
    if (disposition.includes('attachment')) {
      throw new Error(
        'OSS 对象的 Content-Disposition 为 attachment，浏览器会触发下载而非在线预览。' +
        '请在阿里云 OSS 控制台 → 桶列表 → 权限管理 → 跨域设置 或 基础设置 中，' +
        '移除默认 Content-Disposition 策略（将 attachment 改为 inline 或删除该配置）。'
      );
    }
    if (!ct.includes('text/html')) {
      console.warn(`[ossPreview] 上传后验证：Content-Type 为「${ct || '未知'}」，预期 text/html。`);
    }
  }

  return {
    object_key: objectKey,
    url: previewUrl,
  };
}

async function deletePreview(objectKey) {
  const region = requiredEnv('ALI_OSS_REGION');
  const bucket = requiredEnv('ALI_OSS_BUCKET');
  const accessKeyId = requiredEnv('ALI_OSS_ACCESS_KEY_ID');
  const accessKeySecret = requiredEnv('ALI_OSS_ACCESS_KEY_SECRET');
  const host = `${bucket}.${region}.aliyuncs.com`;
  const resource = `/${bucket}/${objectKey}`;
  const method = 'DELETE';
  const date = new Date().toUTCString();
  const authorization = buildOssAuthorization({
    method,
    contentMd5: '',
    contentType: '',
    date,
    resource,
    accessKeyId,
    accessKeySecret,
  });

  const response = await fetch(`https://${host}/${objectKey}`, {
    method,
    headers: {
      Authorization: authorization,
      Date: date,
    },
  });

  // 404表示文件不存在，也视为成功
  if (!response.ok && response.status !== 404) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`OSS 删除失败：${response.status} ${errorText.slice(0, 200)}`);
  }

  return { success: true, object_key: objectKey };
}

async function deletePreviewByProject(projectId) {
  const region = requiredEnv('ALI_OSS_REGION');
  const bucket = requiredEnv('ALI_OSS_BUCKET');
  const accessKeyId = requiredEnv('ALI_OSS_ACCESS_KEY_ID');
  const accessKeySecret = requiredEnv('ALI_OSS_ACCESS_KEY_SECRET');
  const host = `${bucket}.${region}.aliyuncs.com`;
  const prefix = `geo-agent/previews/${encodeURIComponent(projectId)}/`;

  // 列出该项目下的所有文件
  const listResource = `/${bucket}/?prefix=${prefix}&delimiter=/`;
  const listDate = new Date().toUTCString();
  const listAuthorization = buildOssAuthorization({
    method: 'GET',
    contentMd5: '',
    contentType: '',
    date: listDate,
    resource: listResource,
    accessKeyId,
    accessKeySecret,
  });

  const listResponse = await fetch(`https://${host}/?prefix=${prefix}&delimiter=/`, {
    method: 'GET',
    headers: {
      Authorization: listAuthorization,
      Date: listDate,
    },
  });

  if (!listResponse.ok) {
    const errorText = await listResponse.text().catch(() => '');
    throw new Error(`OSS 列举文件失败：${listResponse.status} ${errorText.slice(0, 200)}`);
  }

  const listText = await listResponse.text();
  const keyMatches = listText.match(/<Key>([^<]+)<\/Key>/g) || [];
  const keys = keyMatches.map((m) => m.replace(/<\/?Key>/g, ''));

  // 逐个删除
  for (const key of keys) {
    await deletePreview(key);
  }

  return { success: true, deleted_count: keys.length };
}

function getPreviewHtml({ title, content, owner }) {
  return renderPreviewHtml({ title, content, owner });
}

module.exports = {
  escapeHtml,
  renderPreviewHtml,
  getPreviewUrl,
  getPreviewHtml,
  uploadPreview,
  deletePreview,
  deletePreviewByProject,
};
