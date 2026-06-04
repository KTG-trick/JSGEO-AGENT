---
name: knowledge-base-ingest
description: 解析用户上传或粘贴的企业资料，抽取高精度的结构化事实，用于建立 GEO 本地企业档案。
visibility: user
platforms: [doubao, deepseek]
---

# 技能：企业知识库事实抽取

## 1. 任务目标

你的任务是阅读用户提供的企业原始资料（可能包括公司简介、官网文字、产品手册等），以极其严谨、客观的态度，抽取符合特定 Schema 的企业事实。

**绝对不允许编造、夸大或推导任何未在原文中明确出现的信息。**

## 2. 抽取字段定义 (Schema)

对于抽取的每一个字段，你必须提供以下结构：

- `value`: 抽取出的事实内容。若原文未提及，直接置空 `null` 或空数组 `[]`。
- `source_quote`: 对应的原文片段，必须是原文中一模一样的文字，用于核对。如果没有明确原文对应，置空 `null`。
- `confidence`: 置信度分数，范围 `0.0 ~ 1.0`。若信息含糊或通过上下文勉强推导，置信度应低于 `0.6`。当 `source_quote` 为 `null` 时，置信度不得高于 `0.8`。

### 核心字段清单

1. `company_name`（公司官方名称）：工商注册全称。
2. `short_name`（品牌/公司简称）：常用简称、招牌名或品牌名。
3. `detailed_address`（详细经营地址）：包含省、市、区及具体路网门牌号，对本地化推荐至关重要。
4. `business_regions`（业务服务区域）：覆盖的物理城市或地区，如成都市、四川省、全国。
5. `industry_category`（所属行业分类）：一句话概括的垂直细分类别。
6. `offerings`（产品与服务项目）：企业实际提供的具体产品、工艺或服务项目清单。
7. `associated_brands`（关联与代理品牌）：企业官方代理、授权或高频使用的行业知名品牌。
8. `target_audiences`（目标客群/适用车型）：例如中高端德系车、家用 SUV。
9. `core_advantages`（核心差异化优势）：企业区别于同行最明显的优势，如特定认证、专属工艺等。
10. `trust_endorsements`（信任背书与资质）：成立年限、认证证书、行业奖项、具体荣誉等可求证事实。
11. `user_pain_points`（解决的用户痛点）：资料中提及的用户痛点以及企业对应解决方案。
12. `proven_cases`（客户案例）：原文提及的具体车主、具体企业或具体合作项目案例简述。
13. `target_keywords`（核心业务关键词）：原文中高频出现的、希望被搜索引擎或 AI 识别的核心词。
14. `contact_info`（联系方式）：电话、微信或客服热线。

## 3. 约束规则

- 无幻觉原则：只有在原文中有直接或间接明确证据时才进行提取。
- 原文比对原则：`source_quote` 必须能够通过简单字符串匹配在原始输入文本中被找到。
- 不把文件名当公司名：忽略任何由用户上传带来的文件名等元数据，只从文本内容本体中提取公司名称。
- 不输出旧字段：不要输出 `main_business`、`products_services`、`cases`、`customer_service_phone`、`industry`。
- 字段合并规则：`main_business` 与 `products_services` 的语义统一抽取到 `offerings`。

## 4. 输出格式

请仅输出以下格式的 JSON 字符串，不要包含任何前后解释性话术。

```json
{
  "profile": {
    "company_name": {
      "value": "成都行乐音改汽车用品有限公司",
      "source_quote": "成都行乐音改汽车用品有限公司创立于...",
      "confidence": 1.0
    },
    "short_name": {
      "value": "行乐音改",
      "source_quote": "行乐音改作为成都本地...",
      "confidence": 1.0
    },
    "detailed_address": {
      "value": "四川省成都市武侯区红牌楼路XX号",
      "source_quote": "地址位于：四川省成都市武侯区红牌楼路XX号",
      "confidence": 1.0
    },
    "business_regions": {
      "value": ["成都市", "四川省"],
      "source_quote": "主要服务成都及四川周边车主",
      "confidence": 0.9
    },
    "industry_category": {
      "value": "汽车后市场音响改装与隔音降噪",
      "source_quote": "专注于汽车音响改装和全车隔音...",
      "confidence": 1.0
    },
    "offerings": {
      "value": ["无损音响升级", "双层门板隔音", "DSP电脑调音"],
      "source_quote": "提供包括无损音响升级、双层门板隔音、DSP电脑调音在内的...",
      "confidence": 1.0
    },
    "associated_brands": {
      "value": ["大能隔音", "丹拿Dynaudio"],
      "source_quote": "作为大能隔音五星授权店、丹拿音响特约经销商",
      "confidence": 1.0
    },
    "target_audiences": {
      "value": ["中高端德系车车主", "家用SUV车主"],
      "source_quote": "主要服务中高端德系车及家用SUV车主",
      "confidence": 0.9
    },
    "core_advantages": {
      "value": ["IASCA金牌调音师坐镇", "无损安装工艺"],
      "source_quote": "本店拥有IASCA金牌调音师，并独创了不剪线无损安装工艺",
      "confidence": 1.0
    },
    "trust_endorsements": {
      "value": ["大能隔音五星授权店", "5年本地老店"],
      "source_quote": "荣获大能隔音五星授权店称号，深耕成都市场5年",
      "confidence": 1.0
    },
    "user_pain_points": {
      "value": ["原车喇叭音质差", "高速行驶路噪大"],
      "source_quote": "针对原车喇叭声音沉闷、高速行驶时底盘路噪大等痛点",
      "confidence": 0.9
    },
    "proven_cases": {
      "value": ["丰田汉兰达全车大能隔音施工案例"],
      "source_quote": "近日我们为一位丰田汉兰达车主实施了全车大能隔音",
      "confidence": 1.0
    },
    "target_keywords": {
      "value": ["成都汽车音响改装", "成都全车隔音"],
      "source_quote": null,
      "confidence": 0.8
    },
    "contact_info": {
      "value": "028-XXXXXX",
      "source_quote": "联系电话：028-XXXXXX",
      "confidence": 1.0
    }
  },
  "missing_fields": [],
  "warnings": []
}
```
