const crypto = require('node:crypto');
const {
  chatCompletionStream,
  chatJson,
  parseJsonContent,
  responsesJson,
  responsesStream,
} = require('./llmGateway.cjs');
const { getTaskPolicy } = require('./modelPolicyService.cjs');
const {
  fieldText,
  fieldValue,
  normalizeText,
  toEvidenceField,
} = require('./profileFieldService.cjs');
const { getSkill } = require('./skillService.cjs');
const {
  PROFILE_ARRAY_FIELDS,
  PROFILE_FIELD_KEYS,
  REQUIRED_PROFILE_FIELDS,
} = require('../../shared/profileSchema.cjs');

const UNKNOWN_COMPANY_NAME = '待确认企业名称';

const ARRAY_FIELDS = new Set(PROFILE_ARRAY_FIELDS);
const PROFILE_FIELDS = PROFILE_FIELD_KEYS;
const REQUIRED_FIELDS = REQUIRED_PROFILE_FIELDS;

function clamp(value, min = 0, max = 1) {
  const number = Number(value);
  if (Number.isNaN(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function truncateMiddle(text, maxLength = 18000) {
  const value = normalizeText(text);
  if (value.length <= maxLength) return value;
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
      sections.push(`## 文件 ${index + 1}\n${truncateMiddle(document.text, 8000)}`);
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
    '你的任务是阅读用户提供的企业原始资料，以极其严谨、客观的态度抽取结构化企业事实。',
    '绝对不允许编造、夸大或推导任何未在原文中明确出现的信息。',
    '每个字段必须是 { value, source_quote, confidence }。',
    'source_quote 必须是原文中一模一样的文字片段；没有明确原文对应时必须为 null。',
    'source_quote 为 null 时 confidence 不得高于 0.8。',
    '不要把文件名、上传说明、用户指令、模板标题当作公司名或企业事实。',
    '只返回合法 JSON 对象，不要 Markdown，不要解释。',
  ].join('\n');
}

function createUserPrompt(corpus) {
  return JSON.stringify({
    task: 'extract_enterprise_knowledge_profile',
    output_schema: {
      profile: {
        company_name: { value: null, source_quote: null, confidence: 0 },
        short_name: { value: null, source_quote: null, confidence: 0 },
        detailed_address: { value: null, source_quote: null, confidence: 0 },
        business_regions: { value: [], source_quote: null, confidence: 0 },
        industry_category: { value: null, source_quote: null, confidence: 0 },
        offerings: { value: [], source_quote: null, confidence: 0 },
        associated_brands: { value: [], source_quote: null, confidence: 0 },
        target_audiences: { value: [], source_quote: null, confidence: 0 },
        core_advantages: { value: [], source_quote: null, confidence: 0 },
        trust_endorsements: { value: [], source_quote: null, confidence: 0 },
        user_pain_points: { value: [], source_quote: null, confidence: 0 },
        proven_cases: { value: [], source_quote: null, confidence: 0 },
        target_keywords: { value: [], source_quote: null, confidence: 0 },
        contact_info: { value: null, source_quote: null, confidence: 0 },
      },
      missing_fields: ['缺失字段中文名'],
      warnings: ['需要人工注意的问题'],
    },
    field_definitions: {
      company_name: '工商注册全称或资料正文中的公司官方名称。',
      short_name: '常用简称、招牌名或品牌名。',
      detailed_address: '包含省、市、区及具体路网门牌号的经营地址。',
      business_regions: '覆盖的物理城市或地区。',
      industry_category: '一句话概括的垂直细分类别。',
      offerings: '企业实际提供的具体产品、工艺或服务项目清单。',
      associated_brands: '企业官方代理、授权或高频使用的行业知名品牌。',
      target_audiences: '目标客群、适用车型、适用行业或典型用户画像。',
      core_advantages: '企业区别于同行的可证明优势。',
      trust_endorsements: '成立年限、认证证书、行业奖项、具体荣誉等事实。',
      user_pain_points: '资料中提及的用户痛点以及该企业对应的解决方案。',
      proven_cases: '原文提及的具体车主、企业或合作项目案例。',
      target_keywords: '原文中高频出现的核心业务关键词。',
      contact_info: '电话、微信或客服热线。',
    },
    rules: [
      'company_name 只能来自正文，不能来自文件名。',
      'offerings 合并原来的主营业务和产品/服务，不要输出 main_business 或 products_services。',
      'proven_cases 替代旧 cases；contact_info 替代旧 customer_service_phone；industry_category 替代旧 industry。',
      '原文没有出现的字段 value 用 null 或 []，不要脑补。',
      'target_keywords 可以从原文高频业务词提炼；若没有逐字原文，source_quote 为 null 且 confidence <= 0.8。',
    ],
    enterprise_materials: corpus,
  });
}

function buildExtractionMessages(corpus) {
  const skill = getSkill('knowledge-base-ingest');
  if (!skill?.content) {
    throw new Error('knowledge-base-ingest skill not found. Please keep skills/knowledge-base-ingest.md available before creating a knowledge base draft.');
  }

  return [
    { role: 'system', content: skill.content },
    {
      role: 'user',
      content: JSON.stringify({
        task: 'extract_enterprise_knowledge_profile',
        rules: [
          'Follow the knowledge-base-ingest skill exactly.',
          'Return one valid JSON object only. Do not include Markdown, code fences, comments, prefixes, or suffixes.',
          'Each profile field must be an evidence package: { "value": ..., "source_quote": ..., "confidence": ... }.',
          'Do not output legacy fields: main_business, products_services, cases, customer_service_phone, industry.',
          'If a field is missing from the source materials, use null or [] and source_quote null.',
        ],
        enterprise_materials: corpus,
      }),
    },
  ];
}

function emptyForField(field) {
  return ARRAY_FIELDS.has(field) ? [] : null;
}

function normalizeProfile(profile = {}, projectId = null) {
  const normalized = { project_id: projectId };
  PROFILE_FIELDS.forEach((field) => {
    normalized[field] = toEvidenceField(profile[field], emptyForField(field));
  });
  if (!fieldText(normalized, 'company_name')) {
    normalized.company_name = toEvidenceField(UNKNOWN_COMPANY_NAME);
  }
  return normalized;
}

function normalizeFact(field, evidence = {}, index = 0) {
  const value = normalizeText(fieldValue(evidence));
  if (!value) return null;
  const quote = normalizeText(evidence.source_quote);
  return {
    id: crypto.randomUUID(),
    field,
    label: field,
    value,
    source_file: '企业资料',
    source_document_id: `llm-source-${index}`,
    quote: quote || value.slice(0, 220),
    confidence: clamp(evidence.confidence, 0, quote ? 1 : 0.8),
    extraction: 'llm',
  };
}

function missingFieldsForProfile(profile = {}, modelMissingFields = []) {
  const missing = new Set(modelMissingFields.map(normalizeText).filter(Boolean));
  REQUIRED_FIELDS.forEach(([field, label]) => {
    if (!fieldText(profile, field) || fieldText(profile, field) === UNKNOWN_COMPANY_NAME) {
      missing.add(label);
    }
  });
  return [...missing];
}

function buildFieldReviews(profile = {}, facts = []) {
  return REQUIRED_FIELDS.map(([field, label]) => {
    const relatedFacts = facts.filter((fact) => fact.field === field);
    const value = fieldText(profile, field);
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
    if (!fact.quote || seen.has(key)) return quotes;
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
  const profile = normalizeProfile(result.profile || {}, projectId);
  const facts = PROFILE_FIELDS
    .map((field, index) => normalizeFact(field, profile[field], index))
    .filter(Boolean);
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

  const messages = buildExtractionMessages(corpus);
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
    if (!retry) throw error;
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

  const messages = buildExtractionMessages(corpus);
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
    if (!retry) throw error;
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
