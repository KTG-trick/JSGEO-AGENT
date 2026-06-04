import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Enterprise } from '../data/enterprises';
import { profileFieldText } from '../lib/profileFields';

interface EnterpriseContextType {
  currentEnterpriseId: string | null;
  currentEnterprise: Enterprise;
  setEnterpriseId: (id: string) => void;
  enterprises: Enterprise[];
  hasEnterprises: boolean;
  isLoadingEnterprises: boolean;
  refreshEnterprises: () => Promise<void>;
}

const EnterpriseContext = createContext<EnterpriseContextType | undefined>(undefined);

const EMPTY_ENTERPRISE: Enterprise = {
  id: '',
  name: '先录入企业知识库',
  industry: '待录入',
  tag: '企业知识库',
  desc: '当前还没有可优化的企业。请先在知识库中录入企业资料，或在智能助手中选择“知识库录入”技能。',
  sourceCount: 0,
  wordCount: '0 字',
  graphEntities: 0,
  graphTriples: 0,
  ragDepth: '0%',
  lastUpdated: '未录入',
  sources: [],
  queue: [],
};

function estimateWordCount(profile: GeoAgentEnterpriseProfile) {
  const text = [
    profileFieldText(profile, 'company_name'),
    profileFieldText(profile, 'short_name'),
    profileFieldText(profile, 'industry_category'),
    profileFieldText(profile, 'detailed_address'),
    profileFieldText(profile, 'business_regions'),
    profileFieldText(profile, 'offerings'),
    profileFieldText(profile, 'associated_brands'),
    profileFieldText(profile, 'target_audiences'),
    profileFieldText(profile, 'core_advantages'),
    profileFieldText(profile, 'trust_endorsements'),
    profileFieldText(profile, 'user_pain_points'),
    profileFieldText(profile, 'proven_cases'),
    profileFieldText(profile, 'target_keywords'),
  ].filter(Boolean).join('');
  const count = text.length;
  if (count >= 10000) {
    return `${(count / 10000).toFixed(1)}w 字`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k 字`;
  }
  return `${count} 字`;
}

function profileToEnterprise(profile: GeoAgentEnterpriseProfile): Enterprise {
  const id = profile.project_id || profile.id;
  return {
    id,
    name: profileFieldText(profile, 'short_name') || profileFieldText(profile, 'company_name'),
    industry: profileFieldText(profile, 'industry_category') || '未填写行业',
    tag: profileFieldText(profile, 'offerings') || profileFieldText(profile, 'industry_category') || '企业知识库',
    desc: profileFieldText(profile, 'detailed_intro') || profileFieldText(profile, 'offerings') || '暂无企业介绍。',
    sourceCount: profile.entry_count,
    wordCount: estimateWordCount(profile),
    graphEntities: Math.max(0, profile.entry_count),
    graphTriples: Math.max(0, profile.entry_count * 3),
    ragDepth: profile.entry_count > 0 ? '待向量化' : '0%',
    lastUpdated: profile.updated_at,
    sources: [],
    queue: [],
  };
}

export function EnterpriseProvider({ children }: { children: React.ReactNode }) {
  const [currentEnterpriseId, setCurrentEnterpriseId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('current_enterprise_id');
      return saved || null;
    }
    return null;
  });
  const [enterprises, setEnterprises] = useState<Enterprise[]>([]);
  const [isLoadingEnterprises, setIsLoadingEnterprises] = useState(true);

  const refreshEnterprises = useCallback(async () => {
    if (!window.geoAgent?.getKnowledgeProfiles) {
      setEnterprises([]);
      setIsLoadingEnterprises(false);
      return;
    }

    setIsLoadingEnterprises(true);
    try {
      const response = await window.geoAgent.getKnowledgeProfiles();
      const nextEnterprises = (response.profiles ?? []).map(profileToEnterprise);
      setEnterprises(nextEnterprises);
      setCurrentEnterpriseId((current) => {
        const saved = current || localStorage.getItem('current_enterprise_id');
        if (saved && nextEnterprises.some((enterprise) => enterprise.id === saved)) {
          return saved;
        }
        return nextEnterprises[0]?.id ?? null;
      });
    } catch {
      setEnterprises([]);
      setCurrentEnterpriseId(null);
    } finally {
      setIsLoadingEnterprises(false);
    }
  }, []);

  useEffect(() => {
    refreshEnterprises();
    const handleRefresh = () => {
      refreshEnterprises();
    };
    window.addEventListener('geo-agent-enterprises-refresh', handleRefresh);
    return () => window.removeEventListener('geo-agent-enterprises-refresh', handleRefresh);
  }, [refreshEnterprises]);

  useEffect(() => {
    if (currentEnterpriseId) {
      localStorage.setItem('current_enterprise_id', currentEnterpriseId);
    } else {
      localStorage.removeItem('current_enterprise_id');
    }
    
    // Dispatch a custom event so other listeners can react to it if needed
    const event = new CustomEvent('enterpriseChanged', { detail: currentEnterpriseId });
    window.dispatchEvent(event);
  }, [currentEnterpriseId]);

  const setEnterpriseId = (id: string) => {
    setCurrentEnterpriseId(id);
  };

  const currentEnterprise = useMemo(
    () => enterprises.find(e => e.id === currentEnterpriseId) || enterprises[0] || EMPTY_ENTERPRISE,
    [currentEnterpriseId, enterprises]
  );
  const hasEnterprises = enterprises.length > 0;

  return (
    <EnterpriseContext.Provider value={{
      currentEnterpriseId,
      currentEnterprise,
      setEnterpriseId,
      enterprises,
      hasEnterprises,
      isLoadingEnterprises,
      refreshEnterprises,
    }}>
      {children}
    </EnterpriseContext.Provider>
  );
}

export function useEnterprise() {
  const context = useContext(EnterpriseContext);
  if (context === undefined) {
    throw new Error('useEnterprise must be used within an EnterpriseProvider');
  }
  return context;
}
