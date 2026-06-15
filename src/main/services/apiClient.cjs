/**
 * API 客户端工具
 * 提供带超时和重试的 fetch 封装
 */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 判断错误是否应该重试
 */
function shouldRetry(error, statusCode) {
  // 网络错误 - 可重试
  if (error && (error.code === 'ENOTFOUND' || error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT')) {
    return true;
  }

  // 超时错误 - 可重试
  if (error && error.name === 'AbortError') {
    return true;
  }

  // HTTP 状态码 - 可重试
  const retryableStatusCodes = [408, 429, 500, 502, 503, 504];
  if (statusCode && retryableStatusCodes.includes(statusCode)) {
    return true;
  }

  return false;
}

/**
 * 获取错误的状态码
 */
function getStatusCode(error) {
  if (error && error.statusCode) {
    return error.statusCode;
  }
  return null;
}

/**
 * 对错误进行简单分类，用于向用户展示重试原因
 */
function classifyErrorType(error, statusCode, externalSignal) {
  if (error && error.name === 'AbortError' && externalSignal && !externalSignal.aborted) {
    return 'timeout';
  }
  if (error && (error.code === 'ENOTFOUND' || error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT')) {
    return 'network';
  }
  const retryableStatusCodes = [408, 429, 500, 502, 503, 504];
  if (statusCode && retryableStatusCodes.includes(statusCode)) {
    return 'server';
  }
  return 'api';
}

/**
 * 带超时和重试的 fetch 封装
 * @param {string} url - 请求 URL
 * @param {Object} options - fetch 选项
 * @param {Object} retryOptions - 重试选项
 * @returns {Promise<Response>}
 */
async function fetchWithRetry(url, options = {}, retryOptions = {}) {
  const {
    timeout = 30000,        // 默认 30 秒超时
    maxRetries = 3,         // 默认重试 3 次
    retryDelay = 1000,      // 初始重试延迟 1 秒
    retryBackoff = 2,       // 指数退避倍数
    signal: externalSignal, // 外部取消信号
    onRetry,                // 每次重试前的回调
  } = retryOptions;

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (externalSignal?.aborted) {
      const abortError = new Error('AbortError');
      abortError.name = 'AbortError';
      throw abortError;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    let onAbort;
    if (externalSignal) {
      onAbort = () => controller.abort();
      externalSignal.addEventListener('abort', onAbort);
    }

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (externalSignal && onAbort) {
        externalSignal.removeEventListener('abort', onAbort);
      }

      // 如果响应状态码需要重试，且还有重试次数
      if (shouldRetry(null, response.status) && attempt < maxRetries) {
        const delay = retryDelay * Math.pow(retryBackoff, attempt);
        const errorType = classifyErrorType(null, response.status, externalSignal);
        if (typeof onRetry === 'function') {
          onRetry({ attempt: attempt + 1, maxRetries, error: null, errorType, statusCode: response.status });
        }
        console.log(`[API] 请求失败 (HTTP ${response.status})，${delay}ms 后重试 (${attempt + 1}/${maxRetries})...`);
        await sleep(delay);
        continue;
      }

      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      if (externalSignal && onAbort) {
        externalSignal.removeEventListener('abort', onAbort);
      }
      lastError = error;

      // 外部取消信号导致的 AbortError 不重试
      if (externalSignal?.aborted) {
        throw error;
      }

      // 如果错误可以重试，且还有重试次数
      if (attempt < maxRetries && shouldRetry(error)) {
        const delay = retryDelay * Math.pow(retryBackoff, attempt);
        const errorType = classifyErrorType(error, null, externalSignal);
        if (typeof onRetry === 'function') {
          onRetry({ attempt: attempt + 1, maxRetries, error, errorType, statusCode: null });
        }
        console.log(`[API] 请求失败 (${error.message})，${delay}ms 后重试 (${attempt + 1}/${maxRetries})...`);
        await sleep(delay);
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}

/**
 * 带超时的 fetch 封装（无重试）
 * @param {string} url - 请求 URL
 * @param {Object} options - fetch 选项
 * @param {number} timeout - 超时时间（毫秒）
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options = {}, timeout = 30000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * 解析 JSON 响应，处理错误
 * @param {Response} response - fetch 响应
 * @param {number} maxErrorLength - 错误消息最大长度
 * @returns {Promise<any>}
 */
async function parseJsonResponse(response, maxErrorLength = 300) {
  const responseText = await response.text();

  if (!response.ok) {
    const truncatedText = responseText.slice(0, maxErrorLength);
    throw new Error(`HTTP ${response.status}: ${truncatedText}`);
  }

  try {
    return JSON.parse(responseText);
  } catch {
    throw new Error(`响应不是有效的 JSON: ${responseText.slice(0, maxErrorLength)}`);
  }
}

/**
 * 脱敏错误消息
 * @param {string} message - 原始错误消息
 * @returns {string} 脱敏后的错误消息
 */
function sanitizeErrorMessage(message) {
  if (!message) return message;

  // 移除 Bearer token
  let sanitized = message.replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [REDACTED]');

  // 移除 API key
  sanitized = sanitized.replace(/api[_-]?key[=:]\s*[A-Za-z0-9._-]+/gi, 'api_key=[REDACTED]');

  // 移除 Authorization header 值
  sanitized = sanitized.replace(/Authorization['":\s]+['"]?[A-Za-z0-9._-]+/gi, 'Authorization: [REDACTED]');

  return sanitized;
}

module.exports = {
  fetchWithRetry,
  fetchWithTimeout,
  parseJsonResponse,
  sanitizeErrorMessage,
  sleep,
};
