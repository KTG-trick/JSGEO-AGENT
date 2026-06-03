---
name: knowledge-base-ingest
description: 上传或粘贴企业资料，创建本地企业知识库。当用户需要创建知识库、上传企业资料、建立企业档案、导入公司信息时使用此技能。
visibility: user
platforms: [doubao, deepseek]
---

# 企业知识库创建

## 目标

将企业资料（PDF、DOCX、Markdown、TXT 或粘贴内容）解析为结构化知识库，供后续 GEO 工作流使用。

## 为什么需要企业知识库？

AI 在回答推荐类问题时，需要了解企业的基本信息。如果我们把企业资料整理成结构化知识库，AI 就能更好地理解和推荐这家企业。

## 四步工作台

### 步骤 1：资料导入

支持以下格式：

| 格式 | 说明 | 示例 |
|------|------|------|
| PDF | 企业介绍、产品手册 | 公司宣传册.pdf |
| DOCX | Word 文档 | 企业简介.docx |
| Markdown | Markdown 文件 | 公司介绍.md |
| TXT | 纯文本 | 资料.txt |
| 粘贴 | 直接粘贴内容 | 官网内容、产品介绍 |

**要求**：
- 文件解析结果可见
- 解析失败原因可见
- 附件内容和用户指令分开保存

### 步骤 2：AI 事实抽取

从资料中抽取企业事实，包括：

| 字段 | 说明 | 必需 | 示例 |
|------|------|------|------|
| company_name | 公司名称 | 是 | 成都行乐音改汽车用品有限公司 |
| short_name | 公司简称 | 否 | 成都行乐音改 |
| industry | 所属行业 | 是 | 汽车音响改装 |
| main_business | 主营业务 | 是 | 汽车音响无损升级、全车隔音、DSP 调音 |
| products_services | 产品/服务介绍 | 是 | 入门音响升级、发烧级改装、全车隔音 |
| user_pain_points | 用户痛点 | 是 | 预算有限、担心破坏原车、不知道怎么选 |
| core_advantages | 核心优势 | 是 | 专注无损改装、IASCA 认证调音师 |
| trust_endorsements | 信任背书 | 否 | IASCA 认证、5 年经验、2000+ 台车改装 |
| cases | 行业/客户案例 | 否 | 某 4S 店合作案例、某车主改装案例 |
| business_regions | 业务区域范围 | 是 | 成都 |
| target_keywords | 目标关键词 | 是 | 成都汽车音响改装、成都汽车隔音 |
| customer_service_phone | 客服电话 | 否 | 400-xxx-xxxx |

**规则**：
- 每条事实必须有来源片段
- 不编造案例、资质、客户名称
- 不把文件名当公司名
- 不确定信息标记低置信度

### 步骤 3：字段核对确认

用户逐项确认抽取的字段：

- 正确的字段：标记为已确认
- 错误的字段：用户可修改
- 缺失的字段：标记为待补充

**关键**：用户确认前不写正式知识库。

### 步骤 4：入库与索引

确认后执行：

1. 写入 `projects` 表
2. 写入 `enterprise_profiles` 表
3. 写入 `knowledge_entries` 表
4. 切分 `knowledge_chunks`
5. 写入 FTS5 索引
6. 可选：调用 Embedding API 生成向量

## 输出结构

```json
{
  "project_id": "kb-xxx",
  "company_name": "成都行乐音改汽车用品有限公司",
  "industry": "汽车音响改装",
  "main_business": "汽车音响无损升级、全车隔音、DSP 调音",
  "profile": {
    "company_name": "成都行乐音改汽车用品有限公司",
    "short_name": "成都行乐音改",
    "industry": "汽车音响改装",
    "main_business": "汽车音响无损升级、全车隔音、DSP 调音",
    "detailed_intro": "...",
    "products_services": "...",
    "user_pain_points": "...",
    "core_advantages": "...",
    "trust_endorsements": "...",
    "cases": "...",
    "business_regions": "成都",
    "target_keywords": "成都汽车音响改装\n成都汽车隔音\n成都DSP调音"
  },
  "entries": [...],
  "total": 12
}
```

## 质量标准

### 好的抽取结果

- 每条事实有明确的来源
- 字段值准确，没有错误
- 覆盖所有关键字段
- 不确定的信息标记了低置信度

### 坏的抽取结果

- 编造了案例和资质
- 把文件名当公司名
- 字段值不准确
- 缺少关键字段

## 约束

1. 用户确认前不写正式知识库
2. 无 Embedding API Key 时 FTS 仍可用
3. 有 Embedding API Key 时 sqlite-vec 可用
4. 知识库按 project_id 隔离
5. 不得编造企业不存在的信息
