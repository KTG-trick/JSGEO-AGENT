function normalizeBaseUrl(value) {
  return String(value || '').replace(/\/+$/, '');
}

function embeddingConfig() {
  const model = process.env.ARK_EMBEDDING_MODEL || '';
  const apiKey = process.env.ARK_EMBEDDING_API_KEY || process.env.ARK_API_KEY || '';
  const baseUrl = normalizeBaseUrl(
    process.env.ARK_EMBEDDING_BASE_URL
      || process.env.ARK_BASE_URL
      || 'https://ark.cn-beijing.volces.com/api/v3'
  );
  const dimensions = Number(process.env.ARK_EMBEDDING_DIMENSIONS || 0);
  const concurrency = Math.max(1, Number(process.env.ARK_EMBEDDING_CONCURRENCY || 2));

  return {
    apiKey,
    baseUrl,
    concurrency,
    dimensions: Number.isFinite(dimensions) ? dimensions : 0,
    model,
  };
}

function isEmbeddingEnabled() {
  const config = embeddingConfig();
  return Boolean(config.apiKey && config.model);
}

async function embedBatch(texts = []) {
  const config = embeddingConfig();
  if (!config.apiKey || !config.model) {
    throw new Error('Embedding is not configured.');
  }

  const response = await fetch(`${config.baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: texts,
      model: config.model,
      ...(config.dimensions > 0 ? { dimensions: config.dimensions } : {}),
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Embedding request failed: ${response.status} ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  const embeddings = Array.isArray(data?.data) ? data.data : [];
  return embeddings
    .sort((a, b) => Number(a.index || 0) - Number(b.index || 0))
    .map((item) => item.embedding)
    .filter((embedding) => Array.isArray(embedding));
}

async function embedTexts(texts = []) {
  const config = embeddingConfig();
  const cleanTexts = texts.map((text) => String(text || '').trim());
  const batches = [];
  for (let index = 0; index < cleanTexts.length; index += config.concurrency) {
    batches.push(cleanTexts.slice(index, index + config.concurrency));
  }

  const result = [];
  for (const batch of batches) {
    result.push(...await embedBatch(batch));
  }
  return result;
}

module.exports = {
  embedTexts,
  embeddingConfig,
  isEmbeddingEnabled,
};
