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

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
    article { white-space: pre-wrap; font-size: 16px; line-height: 1.85; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title || '未命名稿件')}</h1>
    <div class="meta">${escapeHtml(owner || '')}</div>
    <article>${escapeHtml(content || '')}</article>
  </main>
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

async function uploadPreview({ projectId, articleId, title, content, owner }) {
  const region = requiredEnv('ALI_OSS_REGION');
  const bucket = requiredEnv('ALI_OSS_BUCKET');
  const accessKeyId = requiredEnv('ALI_OSS_ACCESS_KEY_ID');
  const accessKeySecret = requiredEnv('ALI_OSS_ACCESS_KEY_SECRET');
  const publicBaseUrl = requiredEnv('ALI_OSS_PUBLIC_BASE_URL').replace(/\/+$/, '');
  const objectKey = `geo-agent/previews/${encodeURIComponent(projectId)}/${encodeURIComponent(articleId)}.html`;
  const html = renderPreviewHtml({ title, content, owner });
  const body = Buffer.from(html, 'utf8');
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

  return {
    object_key: objectKey,
    url: `${publicBaseUrl}/${objectKey}`,
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
  getPreviewHtml,
  uploadPreview,
  deletePreview,
  deletePreviewByProject,
};
