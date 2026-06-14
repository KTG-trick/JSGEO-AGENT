const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

function loadAttachmentServiceWithDb(db) {
  const servicePath = path.resolve(__dirname, '../src/main/services/attachmentService.cjs');
  const dbPath = path.resolve(__dirname, '../src/main/services/databaseService.cjs');
  delete require.cache[servicePath];
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: { getDb: () => db },
  };
  return require(servicePath);
}

test('uploadAttachment persists original base64 and original_available status', () => {
  let inserted = null;
  const db = {
    prepare: () => ({
      run: (...args) => {
        inserted = args;
        return { changes: 1 };
      },
    }),
  };
  const service = loadAttachmentServiceWithDb(db);

  const result = service.uploadAttachment({
    projectId: 'project-1',
    conversationId: 'conversation-1',
    messageId: 'message-1',
    filename: 'profile.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    content: '[文件: profile.docx]',
    contentBase64: 'data:application/octet-stream;base64,ZmFrZQ==',
  });

  assert.equal(result.assetStatus, 'original_available');
  assert.equal(inserted[9], 'ZmFrZQ==');
  assert.equal(inserted[10], 'original_available');
  assert.equal(inserted[11], 'message-1');
});

test('linkManyToMessage and linkManyToConversation bind stored attachments', () => {
  const calls = [];
  const db = {
    prepare: (sql) => ({
      run: (...args) => {
        calls.push({ sql, args });
        return { changes: 1 };
      },
    }),
    transaction: (fn) => (ids) => fn(ids),
  };
  const service = loadAttachmentServiceWithDb(db);

  service.linkManyToConversation(['att-1', 'att-2'], 'conversation-1');
  service.linkManyToMessage(['att-1', 'att-2'], 'message-1');

  assert.equal(calls.length, 4);
  assert.deepEqual(calls[0].args, ['conversation-1', 'att-1']);
  assert.deepEqual(calls[2].args, ['message-1', 'message-1', 'att-1']);
});
