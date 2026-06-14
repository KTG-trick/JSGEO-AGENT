export function inferKnowledgeIntent(text = '', hasFiles = false, isKnowledgeSkill = false) {
  const value = String(text || '').trim();
  if (isKnowledgeSkill) return 'create';
  if (!value) return 'chat';

  const objectPattern = /(\u77e5\u8bc6\u5e93|\u4f01\u4e1a\u8d44\u6599|\u516c\u53f8\u8d44\u6599|\u54c1\u724c\u8d44\u6599|\u4f01\u4e1a\u4fe1\u606f|\u516c\u53f8\u4fe1\u606f)/;
  const createActionPattern = /(\u521b\u5efa|\u65b0\u5efa|\u5efa\u7acb|\u5f55\u5165|\u751f\u6210|\u5236\u4f5c|\u4ea7\u51fa|\u642d\u5efa|\u5e2e\u6211\u5efa|\u7ed9\u6211\u5efa|\u5efa\u7acb\u4e00\u4e2a|\u521b\u5efa\u4e00\u4e2a)/;
  const createDraftPattern = /(\u77e5\u8bc6\u5e93\u8349\u7a3f|\u5efa\u5e93\u8349\u7a3f|\u4f01\u4e1a\u8d44\u6599\u8349\u7a3f)/;
  const updateActionPattern = /(\u8865\u5145|\u66f4\u65b0|\u5199\u5165|\u4fdd\u5b58\u5230|\u4fee\u6539|\u8ffd\u52a0|\u5b8c\u5584|\u4fee\u6b63|\u52a0\u5165|\u5f55\u5165\u5230|\u540c\u6b65\u5230)/;
  const readOnlyPattern = /(\u5206\u6790|\u67e5\u770b|\u67e5\u8be2|\u57fa\u4e8e|\u7ed3\u5408|\u53c2\u8003|\u8bc4\u4f30|\u68c0\u67e5|\u8bca\u65ad|\u68b3\u7406|\u603b\u7ed3|\u8bf4\u660e|\u95ee\u7b54|\u5199\u6587\u7ae0|\u751f\u6210\u6587\u7ae0|\u5e2e\u6211.*\u5199)/;

  const hasObject = objectPattern.test(value);
  if (!hasObject && !createDraftPattern.test(value)) return 'chat';

  if (updateActionPattern.test(value)) return 'update';
  if (createDraftPattern.test(value)) return 'create';
  if (createActionPattern.test(value) && hasObject) return 'create';
  if (readOnlyPattern.test(value)) return 'chat';

  return 'chat';
}
