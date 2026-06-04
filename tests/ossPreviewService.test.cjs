const assert = require('node:assert/strict');
const test = require('node:test');

const { renderPreviewHtml, uploadPreview } = require('../src/main/services/ossPreviewService.cjs');

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

test('uploadPreview uploads html and returns public url', async () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  try {
    process.env.ALI_OSS_REGION = 'oss-cn-test';
    process.env.ALI_OSS_BUCKET = 'bucket';
    process.env.ALI_OSS_ACCESS_KEY_ID = 'id';
    process.env.ALI_OSS_ACCESS_KEY_SECRET = 'secret';
    process.env.ALI_OSS_PUBLIC_BASE_URL = 'https://cdn.example.com/base/';

    let request;
    global.fetch = async (url, init) => {
      request = { url, init };
      return { ok: true };
    };

    const result = await uploadPreview({
      projectId: 'project 1',
      articleId: 'article/2',
      title: 'Title',
      content: 'Content',
      owner: 'Owner',
    });

    assert.equal(result.object_key, 'geo-agent/previews/project%201/article%2F2.html');
    assert.equal(result.url, 'https://cdn.example.com/base/geo-agent/previews/project%201/article%2F2.html');
    assert.equal(request.url, 'https://bucket.oss-cn-test.aliyuncs.com/geo-agent/previews/project%201/article%2F2.html');
    assert.equal(request.init.method, 'PUT');
    assert.equal(request.init.headers['Content-Type'], 'text/html; charset=utf-8');
    assert.ok(request.init.headers.Authorization.startsWith('OSS id:'));
  } finally {
    process.env = originalEnv;
    global.fetch = originalFetch;
  }
});
