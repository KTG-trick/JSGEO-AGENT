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

test('recommendPublishResources returns heuristic recommendations when AI is unavailable', async () => {
  const servicePath = path.resolve(__dirname, '../src/main/services/publishRecommendationService.cjs');
  const servicesDir = path.dirname(servicePath);
  const draft = {
    id: 'article-1',
    enterprise_project_id: 'project-1',
    article_type: 'support',
    draft: {
      title: '品牌咨询稿',
      article_role: 'support',
      article_theme: '本地装修服务',
      target_question: '杭州装修公司怎么选',
      publication_evidence: {},
    },
  };
  let savedPatch = null;

  delete require.cache[servicePath];
  mockModule(path.join(servicesDir, 'articleDraftService.cjs'), {
    getArticleDraft: () => draft,
    updateArticleDraft: (_articleId, patch) => {
      savedPatch = patch;
      return draft;
    },
  });
  mockModule(path.join(servicesDir, 'chaojimeijieService.cjs'), {
    listResources: ({ maxPrice }) => [
      {
        id: 'chaojimeijie:media:1',
        provider: 'chaojimeijie',
        resource_type: 'media',
        resource_id: 1,
        name: '杭州家居行业网',
        price: 80,
        status: 2,
        raw: { published_rate: '98', published_avg: '30', industry_name: '装修 家居' },
      },
      {
        id: 'chaojimeijie:media:2',
        provider: 'chaojimeijie',
        resource_type: 'media',
        resource_id: 2,
        name: '普通综合站',
        price: Number(maxPrice || 999),
        status: 2,
        raw: { published_rate: '50' },
      },
    ].filter((resource) => !maxPrice || resource.price <= Number(maxPrice)),
  });
  mockModule(path.join(servicesDir, 'knowledgeService.cjs'), {
    getKnowledgeProfile: () => ({
      profile: {
        company_name: { value: '测试企业' },
        industry_category: { value: '装修' },
        business_regions: { value: '杭州' },
        target_keywords: { value: '装修公司 家居' },
      },
    }),
  });
  mockModule(path.join(servicesDir, 'llmGateway.cjs'), {
    chatCompletion: async () => {
      throw new Error('no model');
    },
    parseJsonContent: JSON.parse,
  });
  mockModule(path.join(servicesDir, 'modelPolicyService.cjs'), {
    getTaskPolicy: () => ({ provider: 'openai', model: 'test-model' }),
  });
  mockModule(path.join(servicesDir, 'profileFieldService.cjs'), {
    fieldText: (profile, field) => String(profile?.[field]?.value || '').trim(),
  });

  const service = require(servicePath);
  const result = await service.recommendPublishResources('article-1', { resourceType: 'media', maxPrice: 100 });

  assert.equal(result.recommendations.length, 2);
  assert.equal(result.recommendations[0].resource.resource_id, 1);
  assert.equal(result.meta.ai_used, false);
  assert.match(result.meta.ai_error, /no model/);
  assert.ok(savedPatch.publication_evidence.latest_resource_recommendations.length > 0);

  delete require.cache[servicePath];
});
