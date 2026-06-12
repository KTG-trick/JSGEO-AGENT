const assert = require('node:assert/strict');
const test = require('node:test');

const rules = require('../src/shared/chaojimeijieOrderRules.cjs');

test('order rules expose allowed actions by status', () => {
  assert.equal(rules.canManageOrder({ status_code: 1, resource_type: 'media' }, 'cancel').allowed, true);
  assert.equal(rules.canManageOrder({ status_code: 3, resource_type: 'media' }, 'apply-refund').allowed, true);
  assert.equal(rules.canManageOrder({ status_code: 5, resource_type: 'media' }, 'apply-refund').allowed, false);
  assert.equal(rules.canManageOrder({ status_code: 4, resource_type: 'media' }, 'urge').allowed, false);
});

test('order rules allow republish only for bao-shou-lu media orders', () => {
  assert.equal(
    rules.canManageOrder(
      { status_code: 4, resource_type: 'media' },
      'apply-republish',
      { raw: { record_situation: 2 } }
    ).allowed,
    true
  );
  assert.equal(
    rules.canManageOrder(
      { status_code: 4, resource_type: 'we-media' },
      'apply-republish',
      { raw: { record_situation: 2 } }
    ).allowed,
    false
  );
  assert.equal(
    rules.canManageOrder(
      { status_code: 4, resource_type: 'media' },
      'apply-republish',
      { raw: { record_situation: 1 } }
    ).allowed,
    false
  );
});

test('order rules block duplicate publishing while order is active or published', () => {
  assert.equal(rules.canCreateNewOrder({ status_code: 1 }), false);
  assert.equal(rules.canCreateNewOrder({ status_code: 6 }), false);
  assert.equal(rules.canCreateNewOrder({ status_code: 4 }), false);
  assert.equal(rules.canCreateNewOrder({ status_code: 5 }), true);
  assert.equal(rules.canCreateNewOrder({ status_code: 7 }), true);
  assert.equal(rules.mapOrderStatus(6), 'publishing');
});
