const NETWORK_MODES = {
  NONE: 'none',
  WEB_SEARCH_PLUGIN: 'web_search_plugin',
  DOUBAO_ASSISTANT_SEARCH: 'doubao_assistant_search',
};

const API_FAMILIES = {
  CHAT_COMPLETIONS: 'chat_completions',
  RESPONSES: 'responses',
  DOUBAO_ASSISTANT: 'doubao_assistant',
};

function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function arkModel(...candidates) {
  return candidates.find((item) => String(item || '').trim()) || null;
}

function getTaskPolicy(taskType, context = {}) {
  const task = String(taskType || 'rag_chat');
  const latestIntent = truthy(context.latestIntent);

  if (task === 'knowledge_extraction') {
    const apiFamily = String(process.env.GEO_EXTRACTION_API_FAMILY || API_FAMILIES.RESPONSES).trim().toLowerCase();
    return {
      task_type: task,
      provider: 'openai',
      model: process.env.GEO_EXTRACTION_MODEL || process.env.OPENAI_MODEL || null,
      api_family: apiFamily === API_FAMILIES.CHAT_COMPLETIONS
        ? API_FAMILIES.CHAT_COMPLETIONS
        : API_FAMILIES.RESPONSES,
      network_mode: NETWORK_MODES.NONE,
      deep_thinking: false,
      stream: false,
    };
  }

  if (task === 'source_discovery' || task === 'visibility_check') {
    return {
      task_type: task,
      provider: 'ark',
      model: arkModel(process.env.DOUBAO_ASSISTANT_MODEL, process.env.DOUBAO_RESPONSES_MODEL, process.env.DOUBAO_MODEL, process.env.ARK_MODEL),
      api_family: API_FAMILIES.DOUBAO_ASSISTANT,
      network_mode: NETWORK_MODES.DOUBAO_ASSISTANT_SEARCH,
      deep_thinking: true,
      stream: true,
    };
  }

  if (task === 'casual_chat_latest_info' || latestIntent) {
    return {
      task_type: 'casual_chat_latest_info',
      provider: 'ark',
      model: arkModel(process.env.GEO_GENERATION_MODEL, process.env.DOUBAO_MODEL, process.env.ARK_MODEL),
      api_family: API_FAMILIES.RESPONSES,
      network_mode: NETWORK_MODES.WEB_SEARCH_PLUGIN,
      deep_thinking: false,
      stream: true,
    };
  }

  if (task === 'reflection') {
    const reflectionApiFamily = String(
      process.env.GEO_REFLECTION_API_FAMILY
      || (String(process.env.OPENAI_BASE_URL || '').includes('xint.cc') ? API_FAMILIES.RESPONSES : API_FAMILIES.CHAT_COMPLETIONS)
    ).trim().toLowerCase();
    return {
      task_type: task,
      provider: process.env.GEO_REFLECTION_PROVIDER || 'openai',
      model: process.env.GEO_REFLECTION_MODEL || process.env.OPENAI_MODEL || process.env.DEEPSEEK_MODEL || null,
      api_family: reflectionApiFamily === API_FAMILIES.RESPONSES
        ? API_FAMILIES.RESPONSES
        : API_FAMILIES.CHAT_COMPLETIONS,
      network_mode: NETWORK_MODES.NONE,
      deep_thinking: true,
      stream: false,
    };
  }

  if (task === 'publish_channel_recommendation') {
    return {
      task_type: task,
      provider: process.env.GEO_PUBLISH_RECOMMENDATION_PROVIDER || process.env.GEO_GENERATION_PROVIDER || 'ark',
      model: arkModel(
        process.env.GEO_PUBLISH_RECOMMENDATION_MODEL,
        process.env.GEO_GENERATION_MODEL,
        process.env.DOUBAO_MODEL,
        process.env.ARK_MODEL,
        process.env.OPENAI_MODEL,
        process.env.DEEPSEEK_MODEL
      ),
      api_family: API_FAMILIES.CHAT_COMPLETIONS,
      network_mode: NETWORK_MODES.NONE,
      deep_thinking: false,
      stream: false,
    };
  }

  if (task === 'question_pool_generation') {
    const platform = String(context.platform || '').toLowerCase();
    if (platform === 'deepseek') {
      return {
        task_type: task,
        provider: 'deepseek',
        model: arkModel(process.env.GEO_GENERATION_DEEPSEEK_MODEL, process.env.DEEPSEEK_MODEL),
        api_family: API_FAMILIES.CHAT_COMPLETIONS,
        network_mode: NETWORK_MODES.NONE,
        deep_thinking: false,
        stream: true,
      };
    }
    return {
      task_type: task,
      provider: 'ark',
      model: arkModel(process.env.DOUBAO_ASSISTANT_MODEL, process.env.DOUBAO_RESPONSES_MODEL, process.env.DOUBAO_MODEL, process.env.ARK_MODEL),
      api_family: API_FAMILIES.DOUBAO_ASSISTANT,
      network_mode: NETWORK_MODES.DOUBAO_ASSISTANT_SEARCH,
      deep_thinking: true,
      stream: true,
    };
  }

  if (task === 'support_content_generation') {
    const platform = String(context.platform || '').toLowerCase();
    if (platform === 'deepseek') {
      return {
        task_type: task,
        provider: 'deepseek',
        model: arkModel(process.env.GEO_GENERATION_DEEPSEEK_MODEL, process.env.DEEPSEEK_MODEL),
        api_family: API_FAMILIES.CHAT_COMPLETIONS,
        network_mode: NETWORK_MODES.NONE,
        deep_thinking: false,
        stream: true,
      };
    }
    return {
      task_type: task,
      provider: 'ark',
      model: arkModel(process.env.GEO_GENERATION_DOUBAO_MODEL, process.env.DOUBAO_MODEL, process.env.ARK_MODEL),
      api_family: API_FAMILIES.CHAT_COMPLETIONS,
      network_mode: NETWORK_MODES.NONE,
      deep_thinking: false,
      stream: true,
    };
  }

  return {
    task_type: 'rag_chat',
    provider: process.env.GEO_GENERATION_PROVIDER || 'ark',
    model: arkModel(process.env.GEO_GENERATION_MODEL, process.env.DOUBAO_MODEL, process.env.ARK_MODEL),
    api_family: API_FAMILIES.CHAT_COMPLETIONS,
    network_mode: NETWORK_MODES.NONE,
    deep_thinking: false,
    stream: true,
  };
}

module.exports = {
  API_FAMILIES,
  NETWORK_MODES,
  getTaskPolicy,
};
