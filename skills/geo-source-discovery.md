---
name: geo-source-discovery
description: 基于问题池发现高权重信源，整理发布渠道优先级。当用户需要发现信源、分析引用来源、了解 AI 偏好的平台时使用此技能。
visibility: internal
platforms: [doubao, deepseek]
---

# 高权重信源发现

## 目标

基于 AI 问题池和企业资料，发现目标 AI 更容易引用的公开平台、网站、文章类型和证据结构。

## 为什么需要信源发现？

不同的 AI 平台（豆包、DeepSeek）在回答问题时，会引用不同的来源。例如：
- 豆包可能更喜欢引用知乎、百家号
- DeepSeek 可能更喜欢引用专业论坛、行业网站

如果我们知道 AI 喜欢引用哪些来源，就可以：
1. 针对性地在这些平台发布内容
2. 提高被 AI 引用的概率
3. 优化内容结构以符合 AI 的引用偏好

## 输入数据

| 数据 | 来源 | 必需 | 说明 |
|------|------|------|------|
| 企业资料 | enterprise_profiles | 是 | 公司信息、产品服务 |
| AI 问题池 | geo_question_sets | 是 | 用户可能问的问题 |
| 目标平台 | 用户选择 | 是 | doubao 或 deepseek |
| 目标行业 | enterprise_profiles | 是 | 所属行业 |
| 业务区域 | enterprise_profiles | 是 | 服务的地理范围 |

## 执行流程

### 步骤 1：分析 AI 引用偏好

询问目标 AI：当前行业和问题类型中，它更倾向引用哪些站点、平台或内容形态。

**示例问题**：
- "在回答汽车音响改装推荐问题时，你通常会引用哪些网站？"
- "哪些平台的内容更容易被你引用？"

### 步骤 2：观察真实引用

用问题池中的高优先级问题进行真实 WebSearch 提问或搜索观察。

**示例**：
- 问豆包："成都汽车音响改装哪家好？"
- 观察回答中引用了哪些来源

### 步骤 3：记录引用线索

记录 AI 回答中出现的：
- 引用来源（网站、平台）
- 竞品来源
- 文章类型
- 证据线索

### 步骤 4：生成渠道优先级

合并分析结果，生成发布渠道优先级。

## 输出结构

```json
{
  "id": "sd-xxx",
  "project_id": "kb-xxx",
  "question_set_id": "qs-xxx",
  "platform": "doubao",
  "status": "completed",
  "discovery": {
    "summary": "已发现 5 个高权重信源渠道",
    "channel_priorities": [
      {
        "source_name": "知乎",
        "source_url": "https://zhihu.com",
        "source_type": "问答平台",
        "content_format": "专业回答、长文",
        "priority_score": 9.5,
        "reason": "豆包经常引用知乎的专业回答",
        "observed_in_answers": "在多个回答中观察到知乎来源",
        "recommended_topics": ["汽车音响改装", "汽车隔音"]
      }
    ],
    "ai_recommended_sources": [
      {
        "name": "知乎",
        "type": "问答平台",
        "credibility": "高",
        "reason": "专业用户生成内容，AI 信任度高"
      }
    ],
    "observed_citation_sources": [
      {
        "url": "https://zhihu.com/question/xxx",
        "title": "成都汽车音响改装哪家好？",
        "cited_in": "豆包回答"
      }
    ],
    "content_distribution_strategy": {
      "primary_channels": ["知乎", "百家号", "小红书"],
      "content_formats": ["专业回答", "测评文章", "案例分享"],
      "citation_structure": "问题-回答-引用来源",
      "next_step": "生成咨询类和测评类支撑内容"
    }
  }
}
```

### 字段说明

| 字段 | 说明 |
|------|------|
| channel_priorities | 发布渠道优先级，按 priority_score 排序 |
| ai_recommended_sources | AI 推荐的来源类型 |
| observed_citation_sources | 实际观察到的引用来源 |
| content_distribution_strategy | 内容分发策略建议 |

## 质量标准

### 好的信源发现

- 有真实的观察依据
- 渠道优先级有明确的理由
- 覆盖主要发布渠道
- 为后续内容生成提供指导

### 坏的信源发现

- 编造"已引用"事实
- 没有观察依据的优先级
- 渠道太少或太多
- 无法指导后续内容生成

## 约束

1. 不编造"已引用"事实
2. 没有真实 URL 时可以留空，但必须说明判断依据
3. 输出必须服务后续咨询类、测评类、排行榜类内容生成
4. 第一版只输出发布渠道优先级，不做自动发稿
5. 信源发现结果保存后供阶段四内容生成使用
