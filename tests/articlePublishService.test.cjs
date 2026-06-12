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
    getPreviewUrl: (objectKey) => `https://cdn.example.com/${objectKey}`,
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

test('publishArticle stops when preview url downloads instead of previews', async () => {
  const servicePath = path.resolve(__dirname, '../src/main/services/articlePublishService.cjs');
  const servicesDir = path.dirname(servicePath);
  const draft = {
    id: 'article-1',
    enterprise_project_id: 'project-1',
    platform: 'doubao',
    article_type: 'support',
    status: 'reviewed',
    draft: {
      title: '测试稿件',
      content: '测试正文',
      article_role: 'support',
      publication_evidence: {
        status: 'reviewed',
        preview_url: 'https://cdn.example.com/geo-agent/previews/project-1/article-1.html',
        preview_object_key: 'geo-agent/previews/project-1/article-1.html',
      },
    },
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
  let createOrderCount = 0;
  const originalFetch = global.fetch;

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
  mockModule(path.join(servicesDir, 'chaojimeijieService.cjs'), {
    getLatestOrderByArticle: () => null,
    createOrder: async () => {
      createOrderCount += 1;
      return { partner_sn: 'GA-1', external_sn: 'CMJ-1' };
    },
  });
  mockModule(path.join(servicesDir, 'knowledgeService.cjs'), {
    getKnowledgeProfile: () => ({ profile: { company_name: { value: '测试企业' } } }),
  });
  mockModule(path.join(servicesDir, 'ossPreviewService.cjs'), {
    getPreviewUrl: (objectKey) => `https://cdn.example.com/${objectKey}`,
    uploadPreview: async () => {
      throw new Error('should reuse existing html page');
    },
  });
  mockModule(path.join(servicesDir, 'profileFieldService.cjs'), {
    fieldText: (profile, field) => String(profile?.[field]?.value || '').trim(),
  });
  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: {
      get: (name) => (name.toLowerCase() === 'content-disposition' ? 'attachment; filename="article.html"' : 'text/html; charset=utf-8'),
    },
    text: async () => '<html><body><h1>测试稿件</h1><p>测试正文</p></body></html>',
  });

  try {
    const articlePublishService = require(servicePath);
    await assert.rejects(
      () => articlePublishService.publishArticle('article-1', 'chaojimeijie', { resourceId: 1 }),
      /触发下载/
    );
    assert.equal(createOrderCount, 0);

    global.fetch = async () => ({
      ok: true,
      status: 200,
      headers: {
        get: (name) => (name.toLowerCase() === 'content-disposition' ? '' : 'text/plain; charset=utf-8'),
      },
      text: async () => '测试稿件\n\n测试正文',
    });
    await assert.rejects(
      () => articlePublishService.assertPreviewReadable('https://cdn.example.com/article.txt', {
        title: '测试稿件',
        content: '测试正文',
      }),
      /不是 HTML 页面/
    );

    global.fetch = async () => ({
      ok: true,
      status: 200,
      headers: {
        get: (name) => (name.toLowerCase() === 'content-disposition' ? 'inline' : 'text/html; charset=utf-8'),
      },
      text: async () => '<html><body><h1>测试稿件</h1><p>测试正文</p></body></html>',
    });
    await assert.doesNotReject(() => articlePublishService.assertPreviewReadable('https://preview.example.com/article.html', {
      title: '测试稿件',
      content: '测试正文',
    }));
  } finally {
    global.fetch = originalFetch;
    delete require.cache[servicePath];
  }
});

test('publishArticle blocks duplicate chaojimeijie order while current order is active', async () => {
  const servicePath = path.resolve(__dirname, '../src/main/services/articlePublishService.cjs');
  const servicesDir = path.dirname(servicePath);
  const draft = {
    id: 'article-1',
    enterprise_project_id: 'project-1',
    platform: 'doubao',
    article_type: 'support',
    status: 'publishing',
    draft: {
      title: '测试稿件',
      content: '测试正文',
      article_role: 'support',
      publication_evidence: { status: 'publishing' },
    },
  };
  let uploadCount = 0;
  let createOrderCount = 0;

  delete require.cache[servicePath];
  mockModule(path.join(servicesDir, 'databaseService.cjs'), {
    getDb: () => ({
      prepare: () => ({
        run: () => ({ changes: 1 }),
      }),
    }),
  });
  mockModule(path.join(servicesDir, 'articleDraftService.cjs'), {
    getArticleDraft: () => draft,
    updateArticleDraft: () => draft,
  });
  mockModule(path.join(servicesDir, 'chaojimeijieService.cjs'), {
    getLatestOrderByArticle: () => ({ partner_sn: 'GA-1', status_code: 3, resource_type: 'media' }),
    createOrder: async () => {
      createOrderCount += 1;
      return { partner_sn: 'GA-1', external_sn: 'CMJ-1' };
    },
  });
  mockModule(path.join(servicesDir, 'knowledgeService.cjs'), {
    getKnowledgeProfile: () => ({ profile: { company_name: { value: '测试企业' } } }),
  });
  mockModule(path.join(servicesDir, 'ossPreviewService.cjs'), {
    uploadPreview: async () => {
      uploadCount += 1;
      return { url: 'https://preview.example.com/article.html', object_key: 'article.html' };
    },
  });
  mockModule(path.join(servicesDir, 'profileFieldService.cjs'), {
    fieldText: (profile, field) => String(profile?.[field]?.value || '').trim(),
  });

  const articlePublishService = require(servicePath);
  await assert.rejects(
    () => articlePublishService.publishArticle('article-1', 'chaojimeijie', { resourceId: 1 }),
    /不能重复投递/
  );
  assert.equal(uploadCount, 0);
  assert.equal(createOrderCount, 0);

  delete require.cache[servicePath];
});

test('prepareArticlePreview replaces old txt source with html preview page', async () => {
  const servicePath = path.resolve(__dirname, '../src/main/services/articlePublishService.cjs');
  const servicesDir = path.dirname(servicePath);
  const draft = {
    id: 'article-1',
    enterprise_project_id: 'project-1',
    platform: 'doubao',
    article_type: 'support',
    status: 'reviewed',
    draft: {
      title: '测试稿件',
      content: '测试正文',
      article_role: 'support',
      publication_evidence: {
        status: 'reviewed',
        preview_url: 'https://cdn.example.com/geo-agent/previews/project-1/article-1.txt',
        preview_object_key: 'geo-agent/previews/project-1/article-1.txt',
      },
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
    getPreviewUrl: (objectKey) => `https://cdn.example.com/${objectKey}`,
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
  const preview = await articlePublishService.prepareArticlePreview('article-1');

  assert.equal(uploadCount, 1);
  assert.equal(preview.object_key, 'geo-agent/previews/project-1/article-1.html');
  assert.equal(preview.draft.draft.publication_evidence.preview_object_key, 'geo-agent/previews/project-1/article-1.html');

  delete require.cache[servicePath];
});
