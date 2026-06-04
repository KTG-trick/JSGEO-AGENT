---
name: geo-source-discovery
description: 使用豆包助手联网搜索发现高权重信源，整理发布渠道优先级。当用户需要阶段三、信源发现、引用来源观察、发布渠道优先级时使用此技能。
visibility: internal
platforms: [doubao]
---

# 高权重信源发现

## 目标

阶段三只使用豆包助手联网搜索发现高权重信源。

系统需要基于用户已确认的 6-10 条核心问题，观察豆包助手联网回答时出现的 URL、域名、平台和内容形态，再生成后续发稿渠道优先级。

## 关键原则

- 唯一实测来源：豆包助手联网搜索。
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
| 目标执行器 | 固定 | 是 | 豆包助手 reasoning_search |

## 执行流程

1. 读取阶段二已确认的 6-10 条核心问题。
2. 向豆包助手询问该行业和问题类型更容易引用的平台、站点和内容形态，得到 AI 自述偏好。
3. 对每条核心问题单独发起一次豆包助手联网搜索。
4. 从搜索事件、最终 raw response、回答正文中提取 URL、域名、标题和来源类型。
5. 聚合同一域名或同一平台的出现次数、覆盖问题数和证据类型。
6. 按“实测 URL > 回答正文提及 > AI 自述偏好”生成渠道优先级。
7. 输出建议发布渠道、内容形态、推荐主题和证据结构。

## 输出 JSON 结构

```json
{
  "evidence_mode": "doubao_assistant_reasoning_search",
  "source_result_origin": "doubao_assistant",
  "summary": "已使用豆包助手联网搜索观察 8 条核心问题，提取 12 条可核验 URL。",
  "status": "completed",
  "input_confirmed_questions": [
    {
      "id": "q1",
      "question": "成都高新区汽车隔音改装哪家比较好？",
      "intent": "ranking_rec",
      "keyword_layer": "regional"
    }
  ],
  "ai_stated_preferences": {
    "summary": "豆包助手倾向参考本地生活平台、汽车垂直媒体和问答平台。",
    "search_queries": ["汽车隔音改装 推荐 信源"],
    "cited_urls": []
  },
  "observed_search_runs": [
    {
      "question_id": "q1",
      "question": "成都高新区汽车隔音改装哪家比较好？",
      "status": "completed",
      "search_queries": ["成都高新区 汽车隔音 改装 推荐"],
      "answer_excerpt": "回答摘要",
      "cited_urls": [
        {
          "url": "https://example.com/article",
          "domain": "example.com",
          "title": "文章标题",
          "source_name": "示例平台",
          "source_type": "media",
          "content_format": "ranking",
          "evidence_type": "tool_observed",
          "question_id": "q1"
        }
      ]
    }
  ],
  "observed_citation_sources": [],
  "verified_observed_sources": [],
  "channel_priorities": [
    {
      "source_name": "知乎",
      "source_url": "https://www.zhihu.com/question/xxx",
      "source_type": "qa",
      "content_format": "guide",
      "priority_score": 0.86,
      "reason": "在多个核心问题的豆包助手联网回答中观察到相关来源。",
      "observed_question_count": 3,
      "observed_url_count": 5,
      "recommended_topics": ["成都汽车隔音改装哪家好"]
    }
  ],
  "source_scores": [],
  "content_distribution_strategy": {
    "primary_channels": ["知乎", "汽车之家"],
    "content_formats": ["guide", "ranking", "review"],
    "citation_structure": "问题标题、行业判断标准、企业事实证据、案例/测评数据、推荐理由闭环",
    "next_step": "进入首轮 9 篇稿件生成。"
  },
  "missing_evidence": []
}
```

## 质量标准

- 每条核心问题都必须形成一条 `observed_search_runs`。
- 只有真实观察到的 URL 才能进入 `observed_citation_sources` 或 `verified_observed_sources`。
- `channel_priorities` 必须解释为什么该渠道优先。
- DeepSeek 相关流程需要阶段三结果时，只能复用豆包助手结果，不能伪装为 DeepSeek 实测。
