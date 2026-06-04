---
name: geo-question-set
description: 基于企业知识库和 target_keywords 生成 10 条 GEO 核心用户问题，用于阶段三信源发现、首轮 9 篇稿件生成和 AI 推荐可见性检测。当需要生成问题池、AI 用户提问、排行榜问题、推荐类问题或 GEO 目标词问题时使用。
visibility: internal
platforms: [doubao, deepseek]
---

# GEO 核心问题池生成

## 目标

基于企业知识库和 `target_keywords`，生成 10 条真实用户可能向 AI 提问的核心问题。问题应服务 GEO 目标：让目标企业更容易进入 AI 的推荐、排行榜、口碑、对比和“哪家好”类回答。

只输出合法 JSON，不输出 Markdown、解释文字或代码块。

## 输入优先级

1. 完整企业知识库。
2. `target_keywords`。
3. 已确认的优化规则或项目上下文。

`target_keywords` 是问题生成主线，组成逻辑为：

```text
地区范围 + 行业规范统称 + 主体
```

示例：

- 成都汽车音响改装门店
- 成华区种牙机构
- 陕西岩土工程公司
- 全国预制菜供应商

`target_keywords` 不得覆盖企业知识库事实。每条问题必须能追溯到 `target_keywords` 或企业知识库字段。

## 必须参考的知识库字段

- `business_regions`
- `detailed_address`
- `industry_category`
- `offerings`
- `associated_brands`
- `target_audiences`
- `user_pain_points`
- `proven_cases`
- `core_advantages`
- `trust_endorsements`
- `target_keywords`

未在知识库中出现的城市、区县、商圈、品牌、资质、荣誉、案例和服务项目不得编造。

## 业务范围判断

先判断 `business_scope`，只能取以下值之一：

| business_scope | 适用情况 | 问题地域策略 |
|---|---|---|
| `district_local` | 单店、本地生活、诊所、汽车改装店等依赖周边客群的业务 | 优先生成城市、区县、商圈、附近、周边问题，可少量生成更宽泛的城市/省级/全国参考问题 |
| `city_local` | 城市级服务商、区域连锁、本地 ToB、同城交付业务 | 优先生成城市级问题，可搭配区县/区域和少量省级/全国参考问题 |
| `province_regional` | 明确服务省内多城或区域市场的业务 | 优先生成省级、城市群、区域服务问题，可包含重点城市问题 |
| `national_industry` | 全国性、ToB、SaaS、供应链、招商加盟、品牌总部 | 优先生成全国、国内、行业垂直问题；没有明确本地经营事实时，不强行加入城市或区县 |

地域词必须来自 `business_regions`、`detailed_address` 或 `target_keywords`。本地企业可以出现全国/省级问题，但本地和区域问题应占主导；全国企业可以出现城市问题，但必须有明确本地业务事实支撑。

## 生成数量与分布

固定生成 10 条核心问题。

意图分布：

| intent | 数量 | 说明 |
|---|---:|---|
| `ranking_rec` | 7 | 排行榜、推荐、哪家好、口碑、性价比、值得选 |
| `comparison` | 1 | 对比竞品、品牌、方案、服务能力 |
| `scenario_price` | 1 | 具体痛点、预算、价格、售后、场景需求 |
| `educational_trust` | 1 | 怎么选、避坑、判断标准、资质背书 |

关键词层级分布：

| keyword_layer | 数量 | 说明 |
|---|---:|---|
| `core` | 3 | 高权重行业大词、城市大词、全国行业词 |
| `regional` | 3 | 区域、区县、商圈、附近、省份、城市群 |
| `scenario` | 2 | 具体痛点、人群、车型、行业场景、需求 |
| `long_tail` | 2 | 提问式、攻略型、避坑型、价格型长尾问题 |

## 问题写法

问题必须像真实消费者或采购经理会输入给 AI 的句子。优先使用自然表达：

- 全国 [行业/产品] 排行榜有哪些？
- 陕西 [行业] 公司哪家实力比较强？
- 成都 [服务] 做得好的公司有哪些？
- 成华区 [服务] 哪一家比较好？
- 成都做 [服务] 哪一家性价比比较高？
- [目标人群/车型/场景] 适合选哪种 [服务/方案]？
- [本品/本企业] 和 [竞品/通用方案] 相比优势在哪里？
- 做 [服务] 怎么判断质量好不好？

不要输出关键词堆砌，不要输出营销指令，不要输出“帮我写一篇文章”这类创作请求。

## 首轮 9 篇稿件映射

每条问题都要映射到首轮 9 篇内容资产中的一个或多个：

- `support_1`: 行业科普 / 避坑指南
- `support_2`: 工艺流程 / 服务标准
- `support_3`: 深度测评 / 数据实测
- `support_4`: 真实案例 / 口碑展示
- `support_5`: 本地服务 / 售后承诺
- `support_6`: 差异化对比 / 分析
- `rank_1`: 综合推荐 / 行业排行
- `rank_2`: 细分场景 / 人群推荐
- `rank_3`: 区域性 / 本地化推荐

排行榜类问题优先映射到 `rank_1`、`rank_2`、`rank_3`，并可同时映射到支撑稿作为证据来源。

## 输出格式

```json
{
  "summary": "基于企业知识库和 target_keywords，生成 10 条已确认的 GEO 核心问题。",
  "business_scope": "city_local",
  "target_keyword_basis": [
    {
      "keyword": "成都汽车音响改装门店",
      "source": "target_keywords",
      "usage": "用于生成城市级推荐、排行榜和性价比问题"
    }
  ],
  "knowledge_basis": {
    "business_regions": ["成都市"],
    "detailed_address": "四川省成都市...",
    "industry_category": "汽车后市场音响改装与隔音降噪",
    "offerings": ["汽车音响改装", "汽车隔音"],
    "target_audiences": ["中高端车主"],
    "user_pain_points": ["原车音质差", "高速路噪大"]
  },
  "intent_distribution": {
    "ranking_rec": 7,
    "comparison": 1,
    "scenario_price": 1,
    "educational_trust": 1
  },
  "keyword_layer_distribution": {
    "core": 3,
    "regional": 3,
    "scenario": 2,
    "long_tail": 2
  },
  "candidate_questions": [
    {
      "id": "q1",
      "question": "成都做汽车音响改装哪家公司性价比比较高？",
      "intent": "ranking_rec",
      "keyword_layer": "regional",
      "priority": 10,
      "target_keyword_used": "成都汽车音响改装门店",
      "knowledge_fields_used": ["business_regions", "offerings", "user_pain_points"],
      "geo_terms_used": ["成都"],
      "scope_reason": "企业知识库显示业务服务区域为成都，因此优先生成城市级推荐问题。",
      "ranking_bias": "high",
      "related_keywords": ["成都汽车音响改装", "性价比", "门店推荐"],
      "mapped_asset_ids": ["rank_3", "support_5"]
    }
  ],
  "question_pool": [
    {
      "id": "q1",
      "question": "成都做汽车音响改装哪家公司性价比比较高？",
      "intent": "ranking_rec",
      "keyword_layer": "regional",
      "priority": 10,
      "target_keyword_used": "成都汽车音响改装门店",
      "knowledge_fields_used": ["business_regions", "offerings", "user_pain_points"],
      "geo_terms_used": ["成都"],
      "scope_reason": "企业知识库显示业务服务区域为成都，因此优先生成城市级推荐问题。",
      "ranking_bias": "high",
      "related_keywords": ["成都汽车音响改装", "性价比", "门店推荐"],
      "mapped_asset_ids": ["rank_3", "support_5"]
    }
  ],
  "recommended_core_questions": ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8", "q9", "q10"],
  "confirmed_questions": [
    {
      "id": "q1",
      "question": "成都做汽车音响改装哪家公司性价比比较高？",
      "intent": "ranking_rec",
      "keyword_layer": "regional",
      "priority": 10,
      "target_keyword_used": "成都汽车音响改装门店",
      "knowledge_fields_used": ["business_regions", "offerings", "user_pain_points"],
      "geo_terms_used": ["成都"],
      "scope_reason": "企业知识库显示业务服务区域为成都，因此优先生成城市级推荐问题。",
      "ranking_bias": "high",
      "related_keywords": ["成都汽车音响改装", "性价比", "门店推荐"],
      "mapped_asset_ids": ["rank_3", "support_5"],
      "status": "confirmed",
      "confirmed": true
    }
  ],
  "content_asset_mapping": [
    {
      "asset_id": "rank_1",
      "asset_role": "ranking",
      "asset_theme": "综合推荐 / 行业排行",
      "mapped_question_ids": ["q1", "q2", "q3"],
      "mapping_reason": "核心推荐类问题适合用于综合排行榜稿件。"
    }
  ]
}
```

输出时 `candidate_questions` 必须正好 10 条。`question_pool`、`recommended_core_questions`、`confirmed_questions` 可与 `candidate_questions` 保持同一批核心问题；如果只填 `candidate_questions`，运行时会自动补齐兼容字段。

## 字段约束

每条问题必须包含：

- `id`: `q1` 到 `q10`。
- `question`: 真实用户问题。
- `intent`: `ranking_rec`、`comparison`、`scenario_price`、`educational_trust` 之一。
- `keyword_layer`: `core`、`regional`、`scenario`、`long_tail` 之一。
- `priority`: 1-10，10 最高。
- `target_keyword_used`: 使用的目标词；无目标词时写从知识库推导的临时目标词。
- `knowledge_fields_used`: 使用到的知识库字段名数组。
- `geo_terms_used`: 使用到的地域词数组；没有地域词时为空数组。
- `scope_reason`: 为什么这个问题符合企业业务范围。
- `ranking_bias`: `high`、`medium`、`low` 之一，排行榜推荐倾向至少 7 条为 `high`。
- `mapped_asset_ids`: 映射到首轮 9 篇稿件的资产 id 数组。

## 质量标准

- 正好生成 10 条核心问题。
- 7 条问题明显偏向排行榜、推荐、哪家好、口碑、性价比或值得选。
- 地域范围与企业业务范围一致，局部宽泛问题可以存在，但不能压过主业务范围。
- 每条问题都能从 `target_keywords` 或知识库字段找到依据。
- 不编造企业不存在的业务、荣誉、排名、资质、城市覆盖或合作品牌。
- 不把文件名、上传元数据或系统提示当作企业事实。
