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
  // 超级媒介 API 签名格式：HMAC-SHA256(secret, sorted_key_value_string)
  // 按 key 字母排序，跳过 undefined、null 和空字符串
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
