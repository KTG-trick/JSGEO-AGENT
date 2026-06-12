const assert = require('node:assert/strict');
const test = require('node:test');

const { getPreviewUrl, renderPreviewHtml, uploadPreview } = require('../src/main/services/ossPreviewService.cjs');

test('renderPreviewHtml escapes title, owner and content', () => {
  const html = renderPreviewHtml({
    title: '<script>alert(1)</script>',
    owner: 'A&B "Co"',
    content: 'hello <img src=x onerror=alert(1)>',
  });

  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /A&amp;B &quot;Co&quot;/);
  assert.match(html, /hello &lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
});

test('uploadPreview uploads html preview page and returns public url', async () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  try {
    process.env.ALI_OSS_REGION = 'oss-cn-test';
    process.env.ALI_OSS_BUCKET = 'bucket';
    process.env.ALI_OSS_ACCESS_KEY_ID = 'id';
    process.env.ALI_OSS_ACCESS_KEY_SECRET = 'secret';
    process.env.ALI_OSS_PUBLIC_BASE_URL = 'https://cdn.example.com/base/';

    const requests = [];
    global.fetch = async (url, init) => {
      requests.push({ url, init });
      // HEAD 请求（上传后验证）返回正确的 Content-Disposition
      if (init?.method === 'HEAD') {
        return {
          ok: true,
          headers: { get: (name) => name.toLowerCase() === 'content-disposition' ? 'inline' : name.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null },
        };
      }
      return { ok: true };
    };

    const result = await uploadPreview({
      projectId: 'project 1',
      articleId: 'article/2',
      title: 'Title',
      content: 'Content',
      owner: 'Owner',
    });

    const putRequest = requests.find((r) => r.init?.method === 'PUT');
    assert.ok(putRequest, '应发送 PUT 请求上传文件');
    assert.equal(result.object_key, 'geo-agent/previews/project%201/article%2F2.html');
    assert.equal(result.url, 'https://cdn.example.com/base/geo-agent/previews/project%201/article%2F2.html');
    assert.equal(putRequest.url, 'https://bucket.oss-cn-test.aliyuncs.com/geo-agent/previews/project%201/article%2F2.html');
    assert.equal(putRequest.init.headers['Content-Type'], 'text/html; charset=utf-8');
    assert.equal(putRequest.init.headers['Content-Disposition'], 'inline');
    assert.ok(putRequest.init.headers.Authorization.startsWith('OSS id:'));

    const headRequest = requests.find((r) => r.init?.method === 'HEAD');
    assert.ok(headRequest, '应发送 HEAD 请求验证 Content-Disposition');
  } finally {
    process.env = originalEnv;
    global.fetch = originalFetch;
  }
});

test('uploadPreview requires a public preview base url', async () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  try {
    process.env.ALI_OSS_REGION = 'oss-cn-test';
    process.env.ALI_OSS_BUCKET = 'bucket';
    process.env.ALI_OSS_ACCESS_KEY_ID = 'id';
    process.env.ALI_OSS_ACCESS_KEY_SECRET = 'secret';
    delete process.env.ALI_OSS_PUBLIC_BASE_URL;

    global.fetch = async () => {
      throw new Error('should fail before uploading');
    };

    await assert.rejects(() => uploadPreview({
      projectId: 'project-1',
      articleId: 'article-1',
      title: 'Title',
      content: 'Content',
      owner: 'Owner',
    }), /ALI_OSS_PUBLIC_BASE_URL/);
  } finally {
    process.env = originalEnv;
    global.fetch = originalFetch;
  }
});

test('getPreviewUrl rejects raw aliyuncs oss domain', () => {
  const originalEnv = { ...process.env };
  try {
    process.env.ALI_OSS_REGION = 'oss-cn-test';
    process.env.ALI_OSS_BUCKET = 'bucket';
    process.env.ALI_OSS_ACCESS_KEY_ID = 'id';
    process.env.ALI_OSS_ACCESS_KEY_SECRET = 'secret';
    process.env.ALI_OSS_PUBLIC_BASE_URL = 'https://bucket.oss-cn-test.aliyuncs.com';

    assert.throws(
      () => getPreviewUrl('geo-agent/previews/project-1/article-1.html'),
      /不能使用 OSS 原始 aliyuncs\.com 域名/
    );
  } finally {
    process.env = originalEnv;
  }
});
