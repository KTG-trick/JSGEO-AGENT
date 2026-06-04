const {
  PROFILE_FIELD_ALIAS_MAP,
} = require('../../shared/profileSchema.cjs');

function normalizeText(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item)).filter(Boolean).join('\n');
  }
  return String(value ?? '').replace(/\r\n/g, '\n').trim();
}

function isEvidenceField(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, 'value'));
}

function fieldValue(field) {
  if (isEvidenceField(field)) {
    return field.value;
  }
  return field;
}

function fieldText(profile = {}, field) {
  const direct = normalizeText(fieldValue(profile[field]));
  if (direct) {
    return direct;
  }
  const aliases = PROFILE_FIELD_ALIAS_MAP[field] || [];
  for (const alias of aliases) {
    const aliasText = normalizeText(fieldValue(profile[alias]));
    if (aliasText) {
      return aliasText;
    }
  }
  return '';
}

function clampConfidence(value, sourceQuote = null) {
  const number = Number(value);
  const confidence = Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
  return sourceQuote ? confidence : Math.min(confidence, 0.8);
}

function toEvidenceField(input, fallbackEmpty = null) {
  if (isEvidenceField(input)) {
    const sourceQuote = normalizeText(input.source_quote) || null;
    const value = Array.isArray(input.value)
      ? input.value.map((item) => normalizeText(item)).filter(Boolean)
      : normalizeText(input.value) || fallbackEmpty;
    return {
      value,
      source_quote: sourceQuote,
      confidence: clampConfidence(input.confidence, sourceQuote),
    };
  }

  if (Array.isArray(input)) {
    return {
      value: input.map((item) => normalizeText(item)).filter(Boolean),
      source_quote: null,
      confidence: 0.8,
    };
  }

  const value = normalizeText(input);
  return {
    value: value || fallbackEmpty,
    source_quote: null,
    confidence: value ? 0.8 : 0,
  };
}

function compactEvidenceProfile(profile = {}, fields = []) {
  const output = {};
  fields.forEach((field) => {
    const input = profile[field] || (PROFILE_FIELD_ALIAS_MAP[field] || []).map((alias) => profile[alias]).find((value) => normalizeText(fieldValue(value)));
    const evidence = toEvidenceField(input, Array.isArray(fieldValue(input)) ? [] : null);
    const rawValue = evidence.value;
    const hasValue = Array.isArray(rawValue) ? rawValue.length > 0 : normalizeText(rawValue);
    if (hasValue || field === 'company_name') {
      output[field] = evidence;
    }
  });
  ['id', 'project_id', 'generated_long_tail_keywords'].forEach((field) => {
    if (profile[field]) {
      output[field] = profile[field];
    }
  });
  return output;
}

module.exports = {
  compactEvidenceProfile,
  fieldText,
  fieldValue,
  isEvidenceField,
  normalizeText,
  toEvidenceField,
};
