---
name: geo-source-discovery
description: 使用豆包助手联网搜索发现高权重信源，整理发布渠道优先级。当用户需要阶段三、信源发现、引用来源观察、发布渠道优先级时使用此技能。
visibility: internal
platforms: [doubao]
task_type: source_discovery
network_mode: doubao_assistant_search
output_contract: geo_source_discovery
---

# 高权重信源发现

## 目标

阶段三只使用豆包助手联网搜索发现高权重信源。分两步执行：先了解行业信源偏好，再逐条观察真实联网回答中出现的信源。

## 关键原则

- 唯一实测来源：豆包助手联网搜索（reasoning_search）。
- 不调用 DeepSeek 做阶段三信源发现。
- 不使用普通模型推断代替联网观察。
- 不做爬虫，不自动发稿。
- 实测 URL 权重大于 AI 自述偏好。
- 没有观察到 URL 时必须明确记录缺失证据，不能编造来源。

## 输入

| 数据 | 来源 | 必需 | 说明 |
|---|---|---|---|
| 企业资料 | enterprise_profiles | 是 | 企业名称、行业、地址、业务区域、产品服务、优势、背书、关键词 |
| 已确认核心问题 | geo_question_sets.confirmed_questions | 是 | 用户在阶段二确认的 6-10 条北极星问题 |

## 阶段一：行业信源偏好搜索

使用豆包助手联网搜索，了解该行业 AI 回答更可能参考的平台和内容形态。

### 阶段一 System Prompt

```text
你是 GEO 高权重信源发现助手。
本阶段只能使用豆包助手联网搜索观察信源，不允许编造来源。
请先判断这类行业问题中，AI 联网回答更可能参考哪些平台、站点类型和内容形态。
```

### 阶段一 User Prompt 模板

```text
请联网搜索并分析：下面企业和核心问题对应的行业，豆包助手在回答推荐/排行榜问题时通常更容易参考哪些公开信源？

企业资料：
{企业资料摘要，无资料时填”暂无完整企业资料”}

已确认核心问题：
1. {问题一}
2. {问题二}
...

请优先给出平台/网站类型、内容形态、为什么容易被引用，以及适合发布的主题。不要声称已经引用了某 URL，除非联网结果中真的出现。
```

### 要求

- LLM 返回平台/网站类型、内容形态、被引用原因和适合发布的主题。
- 不得声称已引用某 URL，除非联网结果中真的出现。

## 阶段二：逐条核心问题联网观察

对每条核心问题单独发起一次豆包助手联网搜索，观察真实回答中出现的信源。

### 阶段二 System Prompt

```text
你是豆包助手联网搜索观察员。
任务是回答用户真实问题，并尽量保留联网搜索或引用来源。
不要为了完成任务编造 URL；没有找到公开来源就直接说明没有可核验来源。
```

### 阶段二 User Prompt 模板

```text
请联网搜索并回答第 {n}/{total} 个真实用户问题：{问题内容}

企业资料用于理解行业和地域，不要求强行推荐该企业：
{企业资料摘要，无资料时填”暂无完整企业资料”}

回答要求：
1. 先像真实 AI 助手一样回答这个问题。
2. 如搜索或引用了网页，请在回答末尾列出”参考来源”，包含标题和 URL。
3. 如果没有可核验 URL，请明确写”未观察到可核验 URL”。
```

### 阶段二要求

- 每条核心问题独立发起一次搜索，不合并。
- 从搜索事件、原始响应和回答正文中提取 URL、域名、标题和来源类型。
- 未观察到 URL 时明确记录，不编造。

## 后处理

1. 聚合同一域名或同一平台的出现次数、覆盖问题数和证据类型。
2. 按”实测 URL > 回答正文提及 > AI 自述偏好”生成渠道优先级。
3. 输出建议发布渠道、内容形态、推荐主题和证据结构。

## 输出 JSON 结构

```json
{
  “evidence_mode”: “doubao_assistant_reasoning_search”,
  “source_result_origin”: “doubao_assistant”,
  “summary”: “已使用豆包助手联网搜索观察 8 条核心问题，提取 12 条可核验 URL。”,
  “status”: “completed”,
  “input_confirmed_questions”: [
    {
      “id”: “q1”,
      “question”: “成都高新区汽车隔音改装哪家比较好？”,
      “intent”: “ranking_rec”,
      “keyword_layer”: “regional”
    }
  ],
  “ai_stated_preferences”: {
    “summary”: “豆包助手倾向参考本地生活平台、汽车垂直媒体和问答平台。”,
    “search_queries”: [“汽车隔音改装 推荐 信源”],
    “cited_urls”: []
  },
  “observed_search_runs”: [
    {
      “question_id”: “q1”,
      “question”: “成都高新区汽车隔音改装哪家比较好？”,
      “status”: “completed”,
      “search_queries”: [“成都高新区 汽车隔音 改装 推荐”],
      “answer_excerpt”: “回答摘要”,
      “cited_urls”: [
        {
          “url”: “https://example.com/article”,
          “domain”: “example.com”,
          “title”: “文章标题”,
          “source_name”: “示例平台”,
          “source_type”: “media”,
          “content_format”: “ranking”,
          “evidence_type”: “tool_observed”,
          “question_id”: “q1”
        }
      ]
    }
  ],
  “observed_citation_sources”: [],
  “verified_observed_sources”: [],
  “channel_priorities”: [
    {
      “source_name”: “知乎”,
      “source_url”: “https://www.zhihu.com/question/xxx”,
      “source_type”: “qa”,
      “content_format”: “guide”,
      “priority_score”: 0.86,
      “reason”: “在多个核心问题的豆包助手联网回答中观察到相关来源。”,
      “observed_question_count”: 3,
      “observed_url_count”: 5,
      “recommended_topics”: [“成都汽车隔音改装哪家好”]
    }
  ],
  “source_scores”: [],
  “content_distribution_strategy”: {
    “primary_channels”: [“知乎”, “汽车之家”],
    “content_formats”: [“guide”, “ranking”, “review”],
    “citation_structure”: “问题标题、行业判断标准、企业事实证据、案例/测评数据、推荐理由闭环”,
    “next_step”: “进入首轮 9 篇稿件生成。”
  },
  “missing_evidence”: []
}
```

## 质量标准

- 每条核心问题都必须形成一条 `observed_search_runs`。
- 只有真实观察到的 URL 才能进入 `observed_citation_sources` 或 `verified_observed_sources`。
- `channel_priorities` 必须解释为什么该渠道优先。
- 不得编造 URL；没有可核验来源时必须明确记录。
