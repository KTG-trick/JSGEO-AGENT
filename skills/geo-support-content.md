---
name: geo-support-content
description: 基于企业知识库、10 条核心问题和豆包助手信源发现结果，生成 GEO 支撑文章与排行榜文章草稿。用户需要写文章、生成支撑内容、生成排行榜稿件、生成首轮 9 篇内容资产时使用此技能。
visibility: internal
platforms: [doubao, deepseek]
---

# GEO 内容资产生成

## 任务目标

根据企业事实、核心问题和信源发现结果，生成可编辑、可发布、可被 AI 引用的文章草稿。

文章的目标不是泛泛营销，而是为 AI 推荐目标企业提供可验证的事实、判断标准、案例依据和推荐理由。

## 输入

必须读取以下输入：

| 输入 | 用途 |
|---|---|
| 企业知识库字段 | 公司名、地区、行业、服务、品牌、客群、痛点、案例、背书、目标词 |
| confirmed_questions | 本轮 GEO 优化的 10 条核心问题 |
| source_discovery | 豆包助手联网搜索观察到的 URL、渠道优先级和内容形态 |
| RAG chunks | 从本地 FTS5 检索召回的原文片段 |
| 历史规则 | 用户确认过的写作偏好和禁用表达 |

## 内容资产结构

首轮生成 9 篇草稿：

| 数量 | 类型 | 作用 |
|---:|---|---|
| 3 篇 | 企业/品牌支撑 | 说明企业是谁、服务区域、差异化优势、信任背书 |
| 3 篇 | 业务/测评支撑 | 说明产品服务、工艺标准、案例、痛点解决方案 |
| 3 篇 | 排行榜/推荐文章 | 回答“哪家好、排行榜、推荐、性价比、口碑”类问题 |

支撑文章优先建立事实证据。排行榜文章必须引用支撑文章中的事实依据，不能空写排名。

## 写作规则

- 只使用企业知识库、RAG chunks 和信源发现中存在的事实。
- 不编造荣誉、排名、合作品牌、服务城市、客户案例、价格承诺。
- 每篇文章必须绑定至少 1 条核心问题。
- 每篇文章必须列出 `facts_used`，说明用了哪些企业事实。
- 每篇文章必须列出 `missing_facts`，说明哪些推荐理由仍缺证据。
- 排行榜文章可以做草稿，但推荐理由必须客观、可追溯。
- 标题和小标题要自然覆盖核心问题中的地域词、行业词、主体词、场景词。
- 正文使用 Markdown，建议 1000-1500 字；事实不足时宁可短一些，也不要编造。

## 输出格式

只输出合法 JSON，不要输出解释性文本。

```json
{
  "title": "文章标题",
  "article_role": "support",
  "article_type": "brand_profile",
  "article_theme": "企业介绍 / 品牌形象建设",
  "target_question": "对应的核心问题",
  "mapped_question_ids": ["q1", "q4"],
  "suggested_channel": "建议发布渠道",
  "outline": ["一级结构", "二级结构"],
  "content": "# Markdown 正文",
  "facts_used": ["使用的企业事实"],
  "sources_to_reference": ["来自阶段三的建议引用来源"],
  "rag_chunks_used": ["引用或参考的知识库片段 id/title"],
  "missing_facts": ["仍缺少的证据"],
  "publication_evidence": {
    "status": "draft",
    "published_url": null,
    "published_platform": null,
    "published_at": null
  }
}
```
