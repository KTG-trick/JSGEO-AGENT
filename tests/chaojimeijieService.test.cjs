const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const { flatten, request, signPayload } = require('../src/main/services/chaojimeijieService.cjs');

test('signPayload sorts keys, arrays, nested objects and excludes signature', () => {
  const payload = {
    z: 'last',
    list: ['b', 'a'],
    obj: { b: 2, a: 1 },
    signature: 'ignored',
    algorithm: 'sha256',
  };
  const flattened = flatten(payload);
  assert.equal(flattened, 'algorithm=sha256list=abobj=a=1b=2z=last');

  const expected = crypto.createHmac('sha256', 'secret').update(flattened).digest('hex');
  assert.equal(signPayload(payload, 'secret'), expected);
});

test('signPayload uses sha256 by default', () => {
  const payload = { appid: 'app', timestamp: 123 };
  const expected = crypto.createHmac('sha256', 'secret').update(flatten(payload)).digest('hex');
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
