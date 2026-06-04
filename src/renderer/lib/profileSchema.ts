export const PROFILE_FIELD_DEFINITIONS = [
  {
    key: 'company_name',
    label: '公司官方名称',
    group: '基础身份',
    required: true,
    aliases: [],
  },
  {
    key: 'short_name',
    label: '品牌/公司简称',
    group: '基础身份',
    aliases: [],
  },
  {
    key: 'industry_category',
    label: '所属行业分类',
    group: '基础身份',
    required: true,
    aliases: ['industry'],
  },
  {
    key: 'detailed_address',
    label: '详细经营地址',
    group: '基础身份',
    required: true,
    aliases: [],
  },
  {
    key: 'business_regions',
    label: '业务服务区域',
    group: '基础身份',
    isArray: true,
    required: true,
    aliases: [],
  },
  {
    key: 'contact_info',
    label: '联系方式',
    group: '基础身份',
    aliases: ['customer_service_phone'],
  },
  {
    key: 'offerings',
    label: '产品与服务项目',
    group: '服务与品牌',
    isArray: true,
    required: true,
    aliases: ['main_business', 'products_services'],
  },
  {
    key: 'associated_brands',
    label: '关联/代理品牌',
    group: '服务与品牌',
    isArray: true,
    aliases: ['brand_authorization_pricing'],
  },
  {
    key: 'target_audiences',
    label: '目标客群/适用车型',
    group: '服务与品牌',
    isArray: true,
    aliases: [],
  },
  {
    key: 'core_advantages',
    label: '核心差异化优势',
    group: '服务与品牌',
    isArray: true,
    required: true,
    aliases: ['product_features'],
  },
  {
    key: 'trust_endorsements',
    label: '信任背书与资质',
    group: '信任与案例',
    isArray: true,
    required: true,
    aliases: ['brand_authorization_pricing'],
  },
  {
    key: 'user_pain_points',
    label: '解决的用户痛点',
    group: '信任与案例',
    isArray: true,
    aliases: [],
  },
  {
    key: 'proven_cases',
    label: '客户案例',
    group: '信任与案例',
    isArray: true,
    aliases: ['cases'],
  },
  {
    key: 'target_keywords',
    label: '核心业务关键词',
    group: '信任与案例',
    isArray: true,
    required: true,
    aliases: [],
  },
  {
    key: 'official_website',
    label: '官方网站',
    group: '补充资料',
    aliases: [],
  },
  {
    key: 'official_media',
    label: '官方自媒体',
    group: '补充资料',
    aliases: [],
  },
  {
    key: 'detailed_intro',
    label: '企业详细介绍',
    group: '补充资料',
    aliases: [],
  },
  {
    key: 'brand_story',
    label: '品牌故事',
    group: '补充资料',
    aliases: [],
  },
  {
    key: 'current_pain_points',
    label: '目前痛点/现状',
    group: '补充资料',
    aliases: [],
  },
  {
    key: 'extra_info',
    label: '其他信息补充',
    group: '补充资料',
    aliases: [],
  },
  {
    key: 'image_notes',
    label: '图片资料说明',
    group: '补充资料',
    aliases: [],
  },
];

export const PROFILE_FIELD_KEYS = PROFILE_FIELD_DEFINITIONS.map((field) => field.key);
export const PROFILE_ARRAY_FIELDS = PROFILE_FIELD_DEFINITIONS.filter((field) => field.isArray).map((field) => field.key);
export const REQUIRED_PROFILE_FIELDS = PROFILE_FIELD_DEFINITIONS
  .filter((field) => field.required)
  .map((field) => [field.key, field.label] as const);

export const PROFILE_FIELD_ALIAS_MAP = PROFILE_FIELD_DEFINITIONS.reduce<Record<string, string[]>>((map, field) => {
  map[field.key] = field.aliases || [];
  return map;
}, {});

export function profileFieldDefinition(field: string) {
  return PROFILE_FIELD_DEFINITIONS.find((definition) => definition.key === field) || null;
}
