const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const { flatten, request, signPayload } = require('../src/main/services/chaojimeijieService.cjs');

test('signPayload uses HMAC-SHA256 with all params sorted by key', () => {
  const payload = {
    appid: 'test-app-id',
    timestamp: 1234567890,
    algorithm: 'sha256',
    other_param: 'value',
    undefined_param: undefined,
    null_param: null,
    empty_param: '',
  };
  // 签名过滤 null/undefined/空字符串，与 encodeQuery/encodeBody 行为一致
  const stringToSign = 'algorithm=sha256appid=test-app-idother_param=valuetimestamp=1234567890';
  const expected = crypto.createHmac('sha256', 'secret').update(stringToSign).digest('hex');
  assert.equal(signPayload(payload, 'secret'), expected);
});

test('signPayload uses sha256 by default', () => {
  const payload = { appid: 'app', timestamp: 123 };
  // 按 key 字母排序：appid, timestamp
  const stringToSign = 'appid=apptimestamp=123';
  const expected = crypto.createHmac('sha256', 'secret').update(stringToSign).digest('hex');
  assert.equal(signPayload(payload, 'secret'), expected);
});

test('request calls chaojimeijie order action endpoint', async () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  try {
    process.env.CHAOJIMEIJIE_APPID = 'appid';
    process.env.CHAOJIMEIJIE_SECRET = 'secret';
    process.env.CHAOJIMEIJIE_API_BASE_URL = 'https://example.test/api';

    let captured;
    global.fetch = async (url, init) => {
      captured = { url: String(url), init };
      return {
        ok: true,
        text: async () => JSON.stringify({ code: 200, data: { ok: true } }),
      };
    };

    const result = await request('media', 'order-urge', { sn: 'GA-1' }, 'POST');
    assert.deepEqual(result, { ok: true });
    assert.equal(captured.url, 'https://example.test/api/media/order/urge');
    assert.equal(captured.init.method, 'POST');
    assert.match(String(captured.init.body), /sn=GA-1/);
    assert.match(String(captured.init.body), /signature=/);
  } finally {
    process.env = originalEnv;
    global.fetch = originalFetch;
  }
});

test('request maps chaojimeijie management actions to official endpoints', async () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  try {
    process.env.CHAOJIMEIJIE_APPID = 'appid';
    process.env.CHAOJIMEIJIE_SECRET = 'secret';
    process.env.CHAOJIMEIJIE_API_BASE_URL = 'https://example.test/api';

    const capturedUrls = [];
    global.fetch = async (url) => {
      capturedUrls.push(String(url));
      return {
        ok: true,
        text: async () => JSON.stringify({ code: 200, data: { ok: true } }),
      };
    };

    await request('media', 'order-cancel', { sn: 'GA-1', reason: '撤回' }, 'POST');
    await request('media', 'order-refund', { sn: 'GA-1', reason: '未发布' }, 'POST');
    await request('media', 'order-republish', { sn: 'GA-1' }, 'POST');
    await request('we-media', 'order-urge', { sn: 'GA-2' }, 'POST');

    assert.deepEqual(capturedUrls, [
      'https://example.test/api/media/order/cancel',
      'https://example.test/api/media/order/apply-refund',
      'https://example.test/api/media/order/apply-republish',
      'https://example.test/api/we-media/order/urge',
    ]);
  } finally {
    process.env = originalEnv;
    global.fetch = originalFetch;
  }
});

test('request form-encodes title and preview url once', async () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  try {
    process.env.CHAOJIMEIJIE_APPID = 'appid';
    process.env.CHAOJIMEIJIE_SECRET = 'secret';
    process.env.CHAOJIMEIJIE_API_BASE_URL = 'https://example.test/api';

    let captured;
    global.fetch = async (url, init) => {
      captured = { url: String(url), init };
      return {
        ok: true,
        text: async () => JSON.stringify({ code: 200, data: { partner_sn: 'CMJ-1' } }),
      };
    };

    await request('media', 'order', {
      sn: 'GA-1',
      title: '测试 标题',
      content: 'https://cdn.example.com/a b.html?x=1&y=中文',
      remark: '备注 信息',
      owner: '客户 A',
    }, 'POST');

    const body = String(captured.init.body);
    assert.match(body, /title=%E6%B5%8B%E8%AF%95%20%E6%A0%87%E9%A2%98/);
    assert.match(body, /content=https%3A%2F%2Fcdn\.example\.com%2Fa%20b\.html%3Fx%3D1%26y%3D%E4%B8%AD%E6%96%87/);
    assert.doesNotMatch(body, /content=https%253A/);
    assert.match(body, /remark=%E5%A4%87%E6%B3%A8%20%E4%BF%A1%E6%81%AF/);
    assert.match(body, /owner=%E5%AE%A2%E6%88%B7%20A/);
  } finally {
    process.env = originalEnv;
    global.fetch = originalFetch;
  }
});
