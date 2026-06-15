import React, { Component } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      retryKey: 0,
    };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });

    // 调用 onError 回调
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // 记录错误到控制台
    console.error('[ErrorBoundary] 捕获到错误:', error);
    console.error('[ErrorBoundary] 组件栈:', errorInfo.componentStack);
  }

  handleRetry = () => {
    this.setState((prev) => ({
      hasError: false,
      error: null,
      errorInfo: null,
      retryKey: prev.retryKey + 1,
    }));
  };

  handleReload = () => {
    window.location.reload();
  };

  // 脱敏错误消息
  sanitizeMessage(message) {
    if (!message) return message;

    // 移除 API key 和 token
    let sanitized = message.replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [REDACTED]');
    sanitized = sanitized.replace(/api[_-]?key[=:]\s*[A-Za-z0-9._-]+/gi, 'api_key=[REDACTED]');

    // 截断过长的错误消息
    if (sanitized.length > 200) {
      sanitized = sanitized.slice(0, 200) + '...';
    }

    return sanitized;
  }

  render() {
    if (this.state.hasError) {
      // 如果提供了自定义 fallback，使用它
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // 默认的错误 UI
      const errorMessage = this.state.error?.message || '未知错误';
      const displayMessage = this.sanitizeMessage(errorMessage);

      return (
        <div className="flex min-h-[200px] items-center justify-center p-6">
          <div className="w-full max-w-md rounded-lg border border-red-200 bg-red-50 p-6 dark:border-red-800 dark:bg-red-950/30">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/50">
                <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <h3 className="text-[14px] font-semibold text-red-800 dark:text-red-200">
                  页面出现错误
                </h3>
                <p className="text-[12px] text-red-600 dark:text-red-400">
                  应用遇到了一个意外错误
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-md bg-red-100 p-3 dark:bg-red-900/30">
              <p className="font-mono text-[11px] text-red-700 dark:text-red-300">
                {displayMessage}
              </p>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                onClick={this.handleRetry}
                className="inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-[12px] font-medium text-white hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                重试
              </button>
              <button
                onClick={this.handleReload}
                className="inline-flex items-center gap-2 rounded-md border border-red-300 bg-white px-4 py-2 text-[12px] font-medium text-red-700 hover:bg-red-50 dark:border-red-700 dark:bg-red-950 dark:text-red-300 dark:hover:bg-red-900"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                刷新页面
              </button>
            </div>

            {process.env.NODE_ENV === 'development' && this.state.errorInfo && (
              <details className="mt-4">
                <summary className="cursor-pointer text-[11px] text-red-600 hover:text-red-800 dark:text-red-400">
                  查看详细信息
                </summary>
                <pre className="mt-2 max-h-40 overflow-auto rounded bg-red-100 p-2 text-[10px] text-red-700 dark:bg-red-900/30 dark:text-red-300">
                  {this.state.error?.stack}
                  {'\n\n'}
                  {this.state.errorInfo.componentStack}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return <div key={this.state.retryKey}>{this.props.children}</div>;
  }
}
