/**
 * 超级媒介订单状态规则（TypeScript 版，供渲染端使用）
 * 逻辑与 chaojimeijieOrderRules.cjs 完全一致，主进程仍使用 .cjs 版本。
 */

export const ORDER_STATUS_LABELS: Record<number, string> = {
  1: '待处理',
  2: '已拒稿',
  3: '发布中',
  4: '已发布',
  5: '已取消',
  6: '退款中',
  7: '已退款',
  8: '退款被拒',
  9: '已关闭',
  10: '补发中',
  11: '已补发',
  12: '已收录',
};

export const ACTION_LABELS: Record<string, string> = {
  urge: '催稿',
  cancel: '取消订单',
  'apply-refund': '申请退款',
  'apply-republish': '申请补发',
};

const RETRYABLE_ORDER_STATUS_CODES = new Set([2, 5, 7, 8, 9]);
const URGE_STATUS_CODES = new Set([1, 3, 10]);
const REFUND_STATUS_CODES = new Set([3, 10]);
const REPUBLISH_STATUS_CODES = new Set([4, 11]);

function statusCodeOf(order: { status_code?: number | null; status?: number | null } | null | undefined): number | null {
  const value = Number(order?.status_code ?? order?.status);
  return Number.isFinite(value) ? value : null;
}

export function statusLabel(statusCode: number | null | undefined): string {
  return ORDER_STATUS_LABELS[Number(statusCode)] || '未知';
}

function isBaoShouLuResource(resource: { raw?: Record<string, unknown> } | Record<string, unknown> | null | undefined): boolean {
  const raw = (resource && 'raw' in resource ? (resource as { raw?: Record<string, unknown> }).raw : resource) as Record<string, unknown> | undefined;
  return Number(raw?.record_situation) === 2;
}

export function isOrderBlockingRepublish(order: { status_code?: number | null } | null | undefined): boolean {
  const statusCode = statusCodeOf(order);
  if (!statusCode) return false;
  return !RETRYABLE_ORDER_STATUS_CODES.has(statusCode);
}

export function canCreateNewOrder(order: { status_code?: number | null } | null | undefined): boolean {
  return !isOrderBlockingRepublish(order);
}

export function canManageOrder(
  order: { status_code?: number | null; status?: number | null; resource_type?: string; resource?: unknown },
  action: string,
  resource?: unknown,
): { allowed: boolean; reason?: string } {
  const statusCode = statusCodeOf(order);
  const resourceType = order?.resource_type === 'we-media' ? 'we-media' : 'media';

  if (!statusCode) {
    return { allowed: false, reason: '订单状态未知，请先同步超级媒介订单。' };
  }
  if (!ACTION_LABELS[action]) {
    return { allowed: false, reason: '未知订单操作。' };
  }
  if (action === 'urge') {
    return URGE_STATUS_CODES.has(statusCode)
      ? { allowed: true }
      : { allowed: false, reason: `当前订单状态为「${statusLabel(statusCode)}」，不能催稿。` };
  }
  if (action === 'cancel') {
    return statusCode === 1
      ? { allowed: true }
      : { allowed: false, reason: '只有待处理订单可以取消。' };
  }
  if (action === 'apply-refund') {
    return REFUND_STATUS_CODES.has(statusCode)
      ? { allowed: true }
      : { allowed: false, reason: `当前订单状态为「${statusLabel(statusCode)}」，不能申请退款。` };
  }
  if (action === 'apply-republish') {
    if (resourceType !== 'media') {
      return { allowed: false, reason: '自媒体订单不支持申请补发。' };
    }
    if (!REPUBLISH_STATUS_CODES.has(statusCode)) {
      return { allowed: false, reason: `当前订单状态为「${statusLabel(statusCode)}」，不能申请补发。` };
    }
    if (!isBaoShouLuResource(resource || (order as Record<string, unknown>)?.resource)) {
      return { allowed: false, reason: '仅包收录新闻媒体资源支持申请补发。请先同步资源后重试。' };
    }
    return { allowed: true };
  }
  return { allowed: false, reason: '未知订单操作。' };
}

export function availableOrderActions(
  order: { status_code?: number | null; status?: number | null; resource_type?: string; resource?: unknown },
  resource?: unknown,
): string[] {
  return Object.keys(ACTION_LABELS).filter((action) => canManageOrder(order, action, resource).allowed);
}

export function mapOrderStatus(statusCode: number | null | undefined): string {
  const code = Number(statusCode);
  if ([1, 3, 6, 10].includes(code)) return 'publishing';
  if ([4, 11, 12].includes(code)) return 'published';
  if ([2, 5, 7, 8, 9].includes(code)) return 'failed';
  return 'publishing';
}
