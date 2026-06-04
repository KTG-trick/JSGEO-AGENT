import { PROFILE_FIELD_ALIAS_MAP } from './profileSchema';

export type ProfileEvidenceField<T = string | string[] | null> = {
  value: T;
  source_quote?: string | null;
  confidence?: number;
};

export function isProfileEvidenceField(value: unknown): value is ProfileEvidenceField {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.prototype.hasOwnProperty.call(value, 'value')
  );
}

export function profileFieldValue<T = unknown>(profile: Record<string, unknown> | null | undefined, field: string): T | null {
  const raw = profile?.[field];
  if (isProfileEvidenceField(raw)) {
    return raw.value as T;
  }
  if (raw !== undefined && raw !== null) {
    return raw as T;
  }
  const aliases = (PROFILE_FIELD_ALIAS_MAP as Record<string, string[]>)[field] || [];
  for (const alias of aliases) {
    const aliasRaw = profile?.[alias];
    if (isProfileEvidenceField(aliasRaw)) {
      return aliasRaw.value as T;
    }
    if (aliasRaw !== undefined && aliasRaw !== null) {
      return aliasRaw as T;
    }
  }
  return null;
}

export function profileFieldText(profile: Record<string, unknown> | null | undefined, field: string): string {
  const value = profileFieldValue(profile, field);
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '').trim()).filter(Boolean).join('\n');
  }
  return String(value ?? '').trim();
}

export function toProfileEvidenceField<T extends string | string[] | null | undefined>(value: T): ProfileEvidenceField<Exclude<T, undefined> | null> {
  const normalized = Array.isArray(value)
    ? value.map((item) => String(item ?? '').trim()).filter(Boolean)
    : String(value ?? '').trim() || null;
  return {
    value: normalized as Exclude<T, undefined> | null,
    source_quote: null,
    confidence: normalized ? 0.8 : 0,
  };
}
