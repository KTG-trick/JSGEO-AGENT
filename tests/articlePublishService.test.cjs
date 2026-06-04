const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

function mockModule(modulePath, exports) {
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports,
  };
}

test('markArticleReviewed uploads OSS preview before marking reviewed', async () => {
  const servicePath = path.resolve(__dirname, '../src/main/services/articlePublishService.cjs');
  const servicesDir = path.dirname(servicePath);
  const draft = {
    id: 'article-1',
    enterprise_project_id: 'project-1',
    platform: 'doubao',
    article_type: 'support',
    status: 'draft',
    draft: {
      title: '测试稿件',
      content: '测试正文',
      article_role: 'support',
      publication_evidence: { status: 'draft' },
    },
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
  let uploadCount = 0;

  delete require.cache[servicePath];
  mockModule(path.join(servicesDir, 'databaseService.cjs'), {
    getDb: () => ({
      prepare: () => ({
        run: (draftJson, status) => {
          draft.draft = JSON.parse(draftJson);
          draft.status = status;
          return { changes: 1 };
        },
      }),
    }),
  });
  mockModule(path.join(servicesDir, 'articleDraftService.cjs'), {
    getArticleDraft: () => draft,
    updateArticleDraft: () => draft,
  });
  mockModule(path.join(servicesDir, 'chaojimeijieService.cjs'), {});
  mockModule(path.join(servicesDir, 'knowledgeService.cjs'), {
    getKnowledgeProfile: () => ({ profile: { company_name: { value: '测试企业' } } }),
  });
  mockModule(path.join(servicesDir, 'ossPreviewService.cjs'), {
    uploadPreview: async () => {
      uploadCount += 1;
      return {
        url: 'https://cdn.example.com/geo-agent/previews/project-1/article-1.html',
        object_key: 'geo-agent/previews/project-1/article-1.html',
      };
    },
  });
  mockModule(path.join(servicesDir, 'profileFieldService.cjs'), {
    fieldText: (profile, field) => String(profile?.[field]?.value || '').trim(),
  });

  const articlePublishService = require(servicePath);
  const reviewed = await articlePublishService.markArticleReviewed('article-1');
  assert.equal(reviewed.status, 'reviewed');
  assert.equal(reviewed.draft.publication_evidence.status, 'reviewed');
  assert.equal(reviewed.draft.publication_evidence.preview_url, 'https://cdn.example.com/geo-agent/previews/project-1/article-1.html');
  assert.equal(reviewed.draft.publication_evidence.preview_object_key, 'geo-agent/previews/project-1/article-1.html');
  assert.equal(uploadCount, 1);

  delete require.cache[servicePath];
});
