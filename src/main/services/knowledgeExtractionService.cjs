const crypto = require('node:crypto');
const {
  chatCompletionStream,
  chatJson,
  parseJsonContent,
  responsesJson,
  responsesStream,
} = require('./llmGateway.cjs');
const { getTaskPolicy } = require('./modelPolicyService.cjs');

const UNKNOWN_COMPANY_NAME = '待确认企业名称';

const REQUIRED_FIELDS = [
  ['company_name', '企业名称'],
  ['main_business', '主营业务'],
  ['products_services', '产品服务'],
  ['user_pain_points', '用户痛点'],
  ['core_advantages', '核心优势'],
  ['trust_endorsements', '信任背书'],
  ['cases', '案例'],
  ['target_keywords', '目标关键词'],
];

const OPTIONAL_PROFILE_FIELDS = [
  'short_name',
  'industry',
  'official_website',
  'official_media',
  'detailed_intro',
  'brand_story',
  'product_features',
  'brand_authorization_pricing',
  'business_regions',
  'customer_service_phone',
  'current_pain_points',
  'extra_info',
  'image_notes',
  'generated_long_tail_keywords',
];

function normalizeText(value) {
  return String(value || '').replace(/\r\n/g, '\n').trim();
}

function clamp(value, min = 0, max = 1) {
  const number = Number(value);
  if (Number.isNaN(number)) {
    return min;
  }
  return Math.min(max, Math.max(min, number));
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value || {}).filter(([, entryValue]) => entryValue !== undefined && entryValue !== null && String(entryValue).trim() !== '')
  );
}

function truncateMiddle(text, maxLength = 18000) {
  const value = normalizeText(text);
  if (value.length <= maxLength) {
    return value;
  }

  const head = Math.floor(maxLength * 0.7);
  const tail = maxLength - head;
  return `${value.slice(0, head)}\n\n...[中间内容已裁剪]...\n\n${value.slice(-tail)}`;
}

function buildCorpus(documents = [], message = '') {
  const sections = [];
  const userMessage = normalizeText(message);
  if (userMessage) {
    sections.push(`## 用户说明\n${userMessage}`);
  }

  documents
    .filter((document) => document.status === 'parsed' && normalizeText(document.text))
    .forEach((document, index) => {
      sections.push(`## 文件 ${index + 1}: ${document.filename}\n${truncateMiddle(document.text, 8000)}`);
    });

  return truncateMiddle(sections.join('\n\n'), 22000);
}

function validateCorpus(corpus) {
  if (!normalizeText(corpus) || normalizeText(corpus).length < 20) {
    throw new Error('未解析到可用于建库的企业资料。');
  }
}

function createSystemPrompt() {
  return [
    '你是 GEO-Agent Studio 的企业知识库事实抽取器。',
    '你的任务是从用户提供的企业资料原文中抽取事实，生成可人工确认的企业知识库草稿。',
    '必须遵守：',
    '1. 只抽取原文明确出现或可直接归纳的信息，不得编造案例、资质、电话、官网、价格、客户名称。',
    '2. 不要把“请帮我创建知识库”“已上传附件”“模板标题”等用户指令当作企业事实。',
    '3. 每条 fact 必须包含 source_file 和 quote，quote 必须是原文片段或高度贴近原文的短片段。',
    '4. 如果关键信息缺失，把字段放入 missing_fields 和 warnings，不要猜。',
    '5. 只返回 JSON，不要 Markdown，不要解释。',
  ].join('\n');
}

function createUserPrompt(corpus) {
  return JSON.stringify({
    task: 'extract_enterprise_knowledge_draft',
    output_schema: {
      facts: [
        {
          field: 'company_name | main_business | products_services | user_pain_points | core_advantages | trust_endorsements | cases | target_keywords | official_website | industry | business_regions | other',
          label: '中文字段名',
          value: '抽取到的事实内容',
          source_file: '来源文件名或用户说明',
          quote: '支持该事实的原文片段',
          confidence: 0.0,
        },
      ],
      profile: {
        company_name: '',
        short_name: '',
        industry: '',
        main_business: '',
        official_website: '',
        official_media: '',
        detailed_intro: '',
        brand_story: '',
        products_services: '',
        product_features: '',
        user_pain_points: '',
        trust_endorsements: '',
        brand_authorization_pricing: '',
        cases: '',
        business_regions: '',
        customer_service_phone: '',
        current_pain_points: '',
        core_advantages: '',
        extra_info: '',
        target_keywords: '',
      },
      missing_fields: ['缺失字段中文名'],
      warnings: ['需要人工注意的问题'],
    },
    enterprise_materials: corpus,
  });
}

function normalizeFact(fact = {}, index = 0) {
  const value = normalizeText(fact.value);
  const field = normalizeText(fact.field) || 'other';
  if (!value) {
    return null;
  }

  return {
    id: fact.id || crypto.randomUUID(),
    field,
    label: normalizeText(fact.label) || field,
    value,
    source_file: normalizeText(fact.source_file) || '企业资料',
    source_document_id: fact.source_document_id || `llm-source-${index}`,
    quote: normalizeText(fact.quote) || value.slice(0, 220),
    confidence: clamp(fact.confidence, 0, 1),
    extraction: 'llm',
  };
}

function normalizeProfile(profile = {}, projectId = null) {
  const normalized = compactObject({
    project_id: projectId,
    company_name: normalizeText(profile.company_name) || UNKNOWN_COMPANY_NAME,
    main_business: profile.main_business,
    products_services: profile.products_services,
    user_pain_points: profile.user_pain_points,
    core_advantages: profile.core_advantages,
    trust_endorsements: profile.trust_endorsements,
    cases: profile.cases,
    target_keywords: profile.target_keywords,
  });

  OPTIONAL_PROFILE_FIELDS.forEach((field) => {
    if (normalizeText(profile[field])) {
      normalized[field] = normalizeText(profile[field]);
    }
  });

  return normalized;
}

function missingFieldsForProfile(profile = {}, modelMissingFields = []) {
  const missing = new Set(modelMissingFields.map(normalizeText).filter(Boolean));
  REQUIRED_FIELDS.forEach(([field, label]) => {
    if (!normalizeText(profile[field]) || profile[field] === UNKNOWN_COMPANY_NAME) {
      missing.add(label);
    }
  });
  return [...missing];
}

function buildFieldReviews(profile = {}, facts = []) {
  return REQUIRED_FIELDS.map(([field, label]) => {
    const relatedFacts = facts.filter((fact) => fact.field === field);
    const value = normalizeText(profile[field]);
    return {
      field,
      label,
      value: value && value !== UNKNOWN_COMPANY_NAME ? value : '',
      confirmed: false,
      confidence: relatedFacts.length ? Math.max(...relatedFacts.map((fact) => fact.confidence || 0)) : 0,
      source_fact_ids: relatedFacts.map((fact) => fact.id),
      warning: value && value !== UNKNOWN_COMPANY_NAME ? null : '需要人工补充或确认。',
    };
  });
}

function buildSourceQuotes(facts = []) {
  const seen = new Set();
  return facts.reduce((quotes, fact) => {
    const key = `${fact.source_file}:${fact.quote}`;
    if (!fact.quote || seen.has(key)) {
      return quotes;
    }
    seen.add(key);
    quotes.push({
      id: crypto.randomUUID(),
      source_file: fact.source_file,
      source_document_id: fact.source_document_id,
      quote: fact.quote,
      fields: [fact.field],
    });
    return quotes;
  }, []);
}

function normalizeExtractionResult(result = {}, projectId = null) {
  const facts = Array.isArray(result.facts)
    ? result.facts.map(normalizeFact).filter(Boolean)
    : [];
  const profile = normalizeProfile(result.profile || {}, projectId);
  const missingFields = missingFieldsForProfile(profile, Array.isArray(result.missing_fields) ? result.missing_fields : []);
  const fieldReviews = buildFieldReviews(profile, facts);
  const sourceQuotes = buildSourceQuotes(facts);
  const warnings = Array.isArray(result.warnings)
    ? result.warnings.map(normalizeText).filter(Boolean)
    : [];

  if (!facts.length) {
    warnings.push('模型没有抽取到可追溯事实，请补充更完整的企业资料。');
  }

  return {
    facts,
    profile,
    field_reviews: fieldReviews,
    missing_fields: missingFields,
    source_quotes: sourceQuotes,
    warnings,
    extraction_status: facts.length ? (missingFields.length ? 'needs_review' : 'completed') : 'failed',
  };
}

function extractionUsesResponses(policy) {
  return String(policy?.api_family || '').toLowerCase() === 'responses';
}

async function runExtractionJson({ messages, policy, temperature, maxTokens }) {
  if (extractionUsesResponses(policy)) {
    return responsesJson({
      messages,
      temperature,
      maxTokens,
      provider: policy.provider,
      model: policy.model,
      networkMode: policy.network_mode,
      deepThinking: policy.deep_thinking,
    });
  }
  return chatJson({
    messages,
    temperature,
    maxTokens,
    provider: policy.provider,
    model: policy.model,
  });
}

async function extractKnowledgeDraft({ documents = [], message = '', projectId = null, retry = true }) {
  const corpus = buildCorpus(documents, message);
  validateCorpus(corpus);

  const messages = [
    { role: 'system', content: createSystemPrompt() },
    { role: 'user', content: createUserPrompt(corpus) },
  ];
  const policy = getTaskPolicy('knowledge_extraction');

  try {
    const completion = await runExtractionJson({
      messages,
      policy,
      temperature: 0.1,
      maxTokens: 6000,
    });
    return {
      ...normalizeExtractionResult(completion.json, projectId),
      extraction_model: completion.model,
      extraction_provider: completion.provider,
      extraction_api_family: policy.api_family,
    };
  } catch (error) {
    if (!retry) {
      throw error;
    }

    const completion = await runExtractionJson({
      messages: [
        ...messages,
        { role: 'user', content: 'Previous output was not parseable. Return one valid JSON object only, with no Markdown, explanation, prefix, or suffix.' },
      ],
      policy,
      temperature: 0,
      maxTokens: 6000,
    });
    return {
      ...normalizeExtractionResult(completion.json, projectId),
      extraction_model: completion.model,
      extraction_provider: completion.provider,
      extraction_api_family: policy.api_family,
    };
  }
}

async function extractKnowledgeDraftStream({ documents = [], message = '', projectId = null, retry = true, onEvent = null }) {
  const corpus = buildCorpus(documents, message);
  validateCorpus(corpus);

  const messages = [
    { role: 'system', content: createSystemPrompt() },
    { role: 'user', content: createUserPrompt(corpus) },
  ];
  const policy = getTaskPolicy('knowledge_extraction');

  const runStream = async (streamMessages, attempt) => {
    const common = {
      messages: streamMessages,
      temperature: attempt > 1 ? 0 : 0.1,
      maxTokens: 6000,
      provider: policy.provider,
      model: policy.model,
      onEvent,
    };
    const completion = extractionUsesResponses(policy)
      ? await responsesStream({
          ...common,
          taskType: 'knowledge_extraction',
          networkMode: policy.network_mode,
          deepThinking: policy.deep_thinking,
        })
      : await chatCompletionStream({
          ...common,
          taskType: 'knowledge_extraction',
        });
    return {
      completion,
      json: parseJsonContent(completion.content),
    };
  };

  try {
    const { completion, json } = await runStream(messages, 1);
    return {
      ...normalizeExtractionResult(json, projectId),
      extraction_model: completion.model,
      extraction_provider: completion.provider,
      extraction_api_family: policy.api_family,
      extraction_request_id: completion.request_id,
    };
  } catch (error) {
    if (!retry) {
      throw error;
    }
    onEvent?.({
      type: 'model_status',
      task_type: 'knowledge_extraction',
      api_family: policy.api_family,
      message: 'Model output was not parseable. Retrying with stricter JSON instructions.',
      can_proceed: false,
    });
    const { completion, json } = await runStream([
      ...messages,
      { role: 'user', content: 'Previous output was not parseable. Return one valid JSON object only, with no Markdown, explanation, prefix, or suffix.' },
    ], 2);
    return {
      ...normalizeExtractionResult(json, projectId),
      extraction_model: completion.model,
      extraction_provider: completion.provider,
      extraction_api_family: policy.api_family,
      extraction_request_id: completion.request_id,
    };
  }
}

function getConfiguredExtractionModelLabel() {
  const policy = getTaskPolicy('knowledge_extraction');
  return `${policy.provider}:${policy.model || 'not-configured'}`;
}

module.exports = {
  extractKnowledgeDraft,
  extractKnowledgeDraftStream,
  getConfiguredExtractionModelLabel,
  normalizeExtractionResult,
};
