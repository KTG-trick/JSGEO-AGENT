const assert = require('node:assert/strict');
const test = require('node:test');

const loadIntent = () => import('../src/shared/knowledgeIntent.js');

test('knowledge analysis stays in chat intent', async () => {
  const { inferKnowledgeIntent } = await loadIntent();
  assert.equal(inferKnowledgeIntent('\u5e2e\u6211\u5206\u6790\u77e5\u8bc6\u5e93\u6784\u5efa\u60c5\u51b5', false, false), 'chat');
});

test('knowledge based writing stays in chat intent', async () => {
  const { inferKnowledgeIntent } = await loadIntent();
  assert.equal(inferKnowledgeIntent('\u57fa\u4e8e\u77e5\u8bc6\u5e93\u5e2e\u6211\u5199\u6587\u7ae0', false, false), 'chat');
});

test('view current knowledge stays in chat intent for existing readonly flow', async () => {
  const { inferKnowledgeIntent } = await loadIntent();
  assert.equal(inferKnowledgeIntent('\u67e5\u770b\u5f53\u524d\u77e5\u8bc6\u5e93', false, false), 'chat');
});

test('attachment analysis without explicit knowledge action stays in chat intent', async () => {
  const { inferKnowledgeIntent } = await loadIntent();
  assert.equal(inferKnowledgeIntent('\u6211\u4e0a\u4f20\u4e86\u9644\u4ef6\uff0c\u5e2e\u6211\u5206\u6790\u4e00\u4e0b', true, false), 'chat');
});

test('explicit create knowledge request maps to create intent', async () => {
  const { inferKnowledgeIntent } = await loadIntent();
  assert.equal(inferKnowledgeIntent('\u5e2e\u6211\u521b\u5efa\u4f01\u4e1a\u77e5\u8bc6\u5e93', false, false), 'create');
});

test('explicit draft creation with attachment maps to create intent', async () => {
  const { inferKnowledgeIntent } = await loadIntent();
  assert.equal(inferKnowledgeIntent('\u7528\u8fd9\u4e2a\u9644\u4ef6\u5efa\u7acb\u77e5\u8bc6\u5e93\u8349\u7a3f', true, false), 'create');
});

test('explicit supplement knowledge request maps to update intent', async () => {
  const { inferKnowledgeIntent } = await loadIntent();
  assert.equal(inferKnowledgeIntent('\u628a\u9644\u4ef6\u8865\u5145\u5230\u77e5\u8bc6\u5e93', true, false), 'update');
});

test('knowledge ingest skill remains an explicit create signal', async () => {
  const { inferKnowledgeIntent } = await loadIntent();
  assert.equal(inferKnowledgeIntent('\u5206\u6790\u4e00\u4e0b\u8fd9\u4e9b\u8d44\u6599', true, true), 'create');
});
