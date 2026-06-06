import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  AlertCircle,
  Building2,
  CheckCircle2,
  ChevronRight,
  Database,
  Edit3,
  Eye,
  FileText,
  Image,
  Plus,
  RefreshCw,
  Sparkles,
  Target,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { profileFieldText, toProfileEvidenceField } from '../lib/profileFields';
import {
  PROFILE_ARRAY_FIELDS,
  PROFILE_FIELD_DEFINITIONS,
} from '../lib/profileSchema';

type KnowledgeMode = 'list' | 'detail' | 'builder';

const DELETE_CONFIRMATION_TEXT = '确认删除此知识库';

type KnowledgeHealthStatus = 'good' | 'warning' | 'danger' | 'muted';

type KnowledgeHealthDimension = {
  key: string;
  label: string;
  score: number;
  weight: number;
  status: KnowledgeHealthStatus;
  reason: string;
  missingItems: string[];
  recommendedAction: string;
};

type KnowledgeGapItem = {
  label: string;
  priority: 'high' | 'medium' | 'low';
  actionPrompt: string;
};

type GeoStageStatus = {
  label: string;
  status: '可用' | '进行中' | '待启动' | '待开发' | '待重试' | '已暂缓';
  description: string;
};

type KnowledgeHealthReport = {
  score: number;
  verdict: string;
  dimensions: KnowledgeHealthDimension[];
  gaps: KnowledgeGapItem[];
};

type UploadedImageAsset = {
  id: string;
  name: string;
  size: number;
  type: string;
  previewUrl: string;
};

type ProfileFieldKey =
  | 'company_name'
  | 'short_name'
  | 'detailed_address'
  | 'business_regions'
  | 'industry_category'
  | 'offerings'
  | 'associated_brands'
  | 'target_audiences'
  | 'core_advantages'
  | 'trust_endorsements'
  | 'user_pain_points'
  | 'proven_cases'
  | 'target_keywords'
  | 'contact_info'
  | 'official_website'
  | 'official_media'
  | 'detailed_intro'
  | 'brand_story'
  | 'current_pain_points'
  | 'extra_info'
  | 'image_notes';

type ProfileFormState = Record<ProfileFieldKey, string>;

type ProfileFieldDefinition = {
  key: ProfileFieldKey;
  label: string;
  group: string;
  isArray?: boolean;
  required?: boolean;
};

const profileFieldDefinitions = PROFILE_FIELD_DEFINITIONS as ProfileFieldDefinition[];
const profileArrayFields = new Set(PROFILE_ARRAY_FIELDS as ProfileFieldKey[]);

const fieldPlaceholders: Partial<Record<ProfileFieldKey, string>> = {
  company_name: '如：成都行乐音改汽车用品有限公司',
  short_name: '如：行乐音改',
  industry_category: '如：汽车后市场音响改装与隔音降噪',
  detailed_address: '省、市、区、道路与门牌号',
  business_regions: '每行一个区域，如：成都市\n四川省',
  contact_info: '电话、微信或客服热线',
  offerings: '每行一个项目，如：无损音响升级\n双层门板隔音\nDSP电脑调音',
  associated_brands: '每行一个品牌，如：大能隔音\n丹拿Dynaudio',
  target_audiences: '每行一个客群或车型，如：中高端德系车车主\n家用SUV车主',
  core_advantages: '每行一条可证明优势，如：IASCA金牌调音师坐镇',
  trust_endorsements: '每行一条资质、授权、荣誉、成立年限等',
  user_pain_points: '每行一个痛点，如：原车喇叭音质差\n高速行驶路噪大',
  proven_cases: '每行一个明确案例，如：丰田汉兰达全车大能隔音施工案例',
  target_keywords: '每行一个关键词，如：成都汽车音响改装\n成都全车隔音',
  official_website: '官网链接；没有官网可留空',
  official_media: '公众号、抖音、小红书等链接或名称',
  detailed_intro: '公司背景、团队、门店、服务流程、经营理念等',
  brand_story: '品牌由来、初心、代表事件',
  current_pain_points: '如：全网声量弱、缺少权威信源、区域认知不足',
  extra_info: '希望模型记住的业务事实、禁忌表达、品牌语气',
  image_notes: '门店、施工、案例图片的文字说明',
};

const fieldRows: Partial<Record<ProfileFieldKey, number>> = {
  detailed_address: 3,
  business_regions: 3,
  offerings: 6,
  associated_brands: 4,
  target_audiences: 4,
  core_advantages: 5,
  trust_endorsements: 5,
  user_pain_points: 5,
  proven_cases: 5,
  target_keywords: 5,
  official_media: 3,
  detailed_intro: 6,
  brand_story: 4,
  current_pain_points: 4,
  extra_info: 4,
  image_notes: 4,
};

const sectionDescriptions: Record<string, string> = {
  基础身份: '建立企业实体和本地化召回锚点。',
  服务与品牌: '让 AI 明确企业实际提供什么、关联哪些品牌、适合哪些用户。',
  信任与案例: '沉淀 AI 推荐时可引用的证据、案例和用户痛点。',
  补充资料: '用于补充官网、自媒体、企业介绍和素材说明。',
};

const emptyProfile = Object.fromEntries(profileFieldDefinitions.map((field) => [field.key, ''])) as ProfileFormState;

const profileSections: Array<{
  title: string;
  description: string;
  fields: Array<{
    key: keyof ProfileFormState;
    label: string;
    placeholder: string;
    type?: 'input' | 'textarea';
    rows?: number;
    required?: boolean;
  }>;
}> = ['基础身份', '服务与品牌', '信任与案例', '补充资料'].map((title) => ({
  title,
  description: sectionDescriptions[title] || '',
  fields: profileFieldDefinitions
    .filter((field) => field.group === title)
    .map((field) => ({
      key: field.key,
      label: field.label,
      placeholder: fieldPlaceholders[field.key] || '',
      type: fieldRows[field.key] ? 'textarea' : 'input',
      rows: fieldRows[field.key],
      required: field.required,
    })),
}));

export function KnowledgeBase() {
  const [mode, setMode] = useState<KnowledgeMode>('list');
  const [profiles, setProfiles] = useState<GeoAgentEnterpriseProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<GeoAgentEnterpriseProfile | null>(null);
  const [knowledgeEntries, setKnowledgeEntries] = useState<GeoAgentKnowledgeEntry[]>([]);
  const [knowledgeTotal, setKnowledgeTotal] = useState(0);
  const [indexStatus, setIndexStatus] = useState<GeoAgentKnowledgeIndexStatus | null>(null);
  const [geoProject, setGeoProject] = useState<GeoAgentGeoProject | null>(null);
  const [geoWorkflowState, setGeoWorkflowState] = useState<GeoAgentWorkflowState | null>(null);
  const [geoReports, setGeoReports] = useState<Record<'doubao' | 'deepseek', GeoAgentGeoReport | null>>({
    doubao: null,
    deepseek: null,
  });
  const [geoQuestionSets, setGeoQuestionSets] = useState<Record<'doubao' | 'deepseek', GeoAgentGeoQuestionSet | null>>({
    doubao: null,
    deepseek: null,
  });
  const [geoSourceDiscoveries, setGeoSourceDiscoveries] = useState<Record<'doubao' | 'deepseek', GeoAgentGeoSourceDiscovery | null>>({
    doubao: null,
    deepseek: null,
  });
  const [geoArticleDrafts, setGeoArticleDrafts] = useState<Record<'doubao' | 'deepseek', { consulting: GeoAgentGeoArticleDraft | null; review: GeoAgentGeoArticleDraft | null }>>({
    doubao: { consulting: null, review: null },
    deepseek: { consulting: null, review: null },
  });
  const [profileForm, setProfileForm] = useState<ProfileFormState>(emptyProfile);
  const [uploadedImages, setUploadedImages] = useState<UploadedImageAsset[]>([]);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<GeoAgentEnterpriseProfile | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const refreshProfiles = () => {
    if (!window.geoAgent?.getKnowledgeProfiles) {
      setProfiles([]);
      return Promise.resolve();
    }
    return window.geoAgent.getKnowledgeProfiles()
      .then((response) => setProfiles(response.profiles))
      .catch(() => setProfiles([]));
  };

  const refreshKnowledgeEntries = (projectId = selectedProfile?.project_id) => {
    if (!window.geoAgent?.getKnowledgeProfile || !projectId) {
      setKnowledgeEntries([]);
      setKnowledgeTotal(0);
      setIndexStatus(null);
      setGeoProject(null);
      setGeoWorkflowState(null);
      setGeoWorkflowState(null);
      setGeoReports({ doubao: null, deepseek: null });
      setGeoQuestionSets({ doubao: null, deepseek: null });
      setGeoSourceDiscoveries({ doubao: null, deepseek: null });
      setGeoArticleDrafts({ doubao: { consulting: null, review: null }, deepseek: { consulting: null, review: null } });
      return Promise.resolve();
    }

    return window.geoAgent.getKnowledgeProfile(projectId)
      .then((response) => {
        setSelectedProfile(response.profile);
        setKnowledgeEntries(response.entries);
        setKnowledgeTotal(response.total);
        setIndexStatus(response.index_status ?? null);
        return window.geoAgent?.ensureGeoProject?.(projectId)
          .then((project) => {
            setGeoProject(project);
            return refreshGeoReports(project);
          })
          .catch(() => {
            setGeoProject(null);
            setGeoWorkflowState(null);
          });
      })
      .catch(() => {
        setKnowledgeEntries([]);
        setKnowledgeTotal(0);
        setIndexStatus(null);
        setGeoProject(null);
        setGeoWorkflowState(null);
        setGeoReports({ doubao: null, deepseek: null });
        setGeoQuestionSets({ doubao: null, deepseek: null });
        setGeoSourceDiscoveries({ doubao: null, deepseek: null });
        setGeoArticleDrafts({ doubao: { consulting: null, review: null }, deepseek: { consulting: null, review: null } });
      });
  };

  const refreshGeoReports = (project: GeoAgentGeoProject) => {
    const workflowPromise = window.geoAgent?.getGeoWorkflowState
      ? window.geoAgent.getGeoWorkflowState(project.id)
        .then(setGeoWorkflowState)
        .catch(() => setGeoWorkflowState(null))
      : Promise.resolve();
    if (!window.geoAgent?.getLatestGeoReport) {
      setGeoReports({ doubao: null, deepseek: null });
    }
    if (!window.geoAgent?.getLatestGeoQuestionSet) {
      setGeoQuestionSets({ doubao: null, deepseek: null });
    }
    if (!window.geoAgent?.getLatestGeoSourceDiscovery) {
      setGeoSourceDiscoveries({ doubao: null, deepseek: null });
    }
    if (!window.geoAgent?.getLatestGeoArticleDraft) {
      setGeoArticleDrafts({ doubao: { consulting: null, review: null }, deepseek: { consulting: null, review: null } });
    }
    const reportsPromise = Promise.all(
      (['doubao', 'deepseek'] as const).map((platform) =>
        window.geoAgent?.getLatestGeoReport(project.id, platform)
          .then((report) => [platform, report] as const)
          .catch(() => [platform, null] as const)
      )
    ).then((entries) => {
      setGeoReports(Object.fromEntries(entries) as Record<'doubao' | 'deepseek', GeoAgentGeoReport | null>);
    });
    const questionSetsPromise = Promise.all(
      (['doubao', 'deepseek'] as const).map((platform) =>
        window.geoAgent?.getLatestGeoQuestionSet?.(project.id, platform)
          .then((questionSet) => [platform, questionSet] as const)
          .catch(() => [platform, null] as const)
      )
    ).then((entries) => {
      setGeoQuestionSets(Object.fromEntries(entries) as Record<'doubao' | 'deepseek', GeoAgentGeoQuestionSet | null>);
    });
    const sourceDiscoveriesPromise = Promise.all(
      (['doubao', 'deepseek'] as const).map((platform) =>
        window.geoAgent?.getLatestGeoSourceDiscovery?.(project.id, platform)
          .then((discovery) => [platform, discovery] as const)
          .catch(() => [platform, null] as const)
      )
    ).then((entries) => {
      setGeoSourceDiscoveries(Object.fromEntries(entries) as Record<'doubao' | 'deepseek', GeoAgentGeoSourceDiscovery | null>);
    });
    const articleDraftsPromise = Promise.all(
      (['doubao', 'deepseek'] as const).map(async (platform) => {
        const [consulting, review] = await Promise.all([
          window.geoAgent?.getLatestGeoArticleDraft?.(project.id, platform, 'consulting').catch(() => null),
          window.geoAgent?.getLatestGeoArticleDraft?.(project.id, platform, 'review').catch(() => null),
        ]);
        return [platform, { consulting, review }] as const;
      })
    ).then((entries) => {
      setGeoArticleDrafts(Object.fromEntries(entries) as Record<'doubao' | 'deepseek', { consulting: GeoAgentGeoArticleDraft | null; review: GeoAgentGeoArticleDraft | null }>);
    });
    return Promise.all([workflowPromise, reportsPromise, questionSetsPromise, sourceDiscoveriesPromise, articleDraftsPromise]).then(() => undefined);
  };

  useEffect(() => {
    refreshProfiles();
    const handleRefresh = () => refreshProfiles();
    window.addEventListener('geo-agent-enterprises-refresh', handleRefresh);
    return () => window.removeEventListener('geo-agent-enterprises-refresh', handleRefresh);
  }, []);

  useEffect(() => {
    const handleGeoProjectChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string; geoProjectId?: string }>).detail;
      const currentProjectId = selectedProfile?.project_id || selectedProfile?.id;
      if (!currentProjectId) {
        return;
      }
      if (detail?.projectId && detail.projectId !== currentProjectId) {
        return;
      }
      refreshKnowledgeEntries(currentProjectId);
    };
    window.addEventListener('geo-agent-geo-project-changed', handleGeoProjectChanged);
    return () => window.removeEventListener('geo-agent-geo-project-changed', handleGeoProjectChanged);
  }, [selectedProfile?.project_id, selectedProfile?.id]);

  const openEnterprise = (profile: GeoAgentEnterpriseProfile) => {
    setSelectedProfile(profile);
    refreshKnowledgeEntries(profile.project_id || profile.id);
    setMode('detail');
  };

  const startKnowledgeIngest = () => {
    window.dispatchEvent(new CustomEvent('geo-agent-open-view', { detail: { view: 'agent' } }));
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('geo-agent-start-knowledge-ingest', {
        detail: {
          intent: 'create',
          message: '请使用知识库录入技能，引导我上传企业资料并生成知识库草稿。',
        },
      }));
    }, 80);
  };

  const openEditor = () => {
    if (!selectedProfile) {
      return;
    }
    setProfileForm(profileToForm(selectedProfile));
    setUploadedImages([]);
    setIsEditingProfile(true);
    setProfileError(null);
    setMode('builder');
  };

  const handleSaveProfile = async () => {
    if (!profileForm.company_name.trim() || isSavingProfile) {
      return;
    }
    if (!window.geoAgent?.saveEnterpriseProfile) {
      setProfileError('请在 Electron 桌面模式中使用本地知识库。');
      return;
    }

    const projectId = isEditingProfile && selectedProfile?.project_id
      ? selectedProfile.project_id
      : profileForm.short_name.trim() || profileForm.company_name.trim();
    setIsSavingProfile(true);
    setProfileError(null);
    try {
      const payload = compactProfile({
        ...profileForm,
        image_notes: buildImageNotes(uploadedImages),
        project_id: projectId,
      });
      const response = isEditingProfile && window.geoAgent.updateKnowledgeProfile
        ? await window.geoAgent.updateKnowledgeProfile(projectId, payload)
        : await window.geoAgent.saveEnterpriseProfile(payload);
      setKnowledgeEntries(response.entries);
      setKnowledgeTotal(response.total);
      await refreshProfiles();
      window.dispatchEvent(new CustomEvent('geo-agent-enterprises-refresh'));
      await refreshKnowledgeEntries(projectId);
      setMode('detail');
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : '企业知识库保存失败。');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleDeleteProfile = async () => {
    if (!deleteTarget?.project_id || deleteConfirmation !== DELETE_CONFIRMATION_TEXT || isDeleting) {
      return;
    }
    if (!window.geoAgent?.deleteKnowledgeProfile) {
      return;
    }

    setIsDeleting(true);
    try {
      await window.geoAgent.deleteKnowledgeProfile(deleteTarget.project_id);
      setDeleteTarget(null);
      setDeleteConfirmation('');
      setSelectedProfile(null);
      setKnowledgeEntries([]);
      setKnowledgeTotal(0);
      setIndexStatus(null);
      setGeoProject(null);
      await refreshProfiles();
      window.dispatchEvent(new CustomEvent('geo-agent-enterprises-refresh'));
      setMode('list');
    } finally {
      setIsDeleting(false);
    }
  };

  if (mode === 'builder') {
    return (
      <EnterpriseProfileBuilder
        error={profileError}
        form={profileForm}
        images={uploadedImages}
        isEditing={isEditingProfile}
        isSaving={isSavingProfile}
        onBack={() => setMode(isEditingProfile ? 'detail' : 'list')}
        onChange={(key, value) => setProfileForm((current) => ({ ...current, [key]: value }))}
        onImagesChange={setUploadedImages}
        onSave={handleSaveProfile}
      />
    );
  }

  if (mode === 'detail') {
    return (
      <>
        <KnowledgeDetail
          entries={knowledgeEntries}
          geoArticleDrafts={geoArticleDrafts}
          geoProject={geoProject}
          geoWorkflowState={geoWorkflowState}
          geoQuestionSets={geoQuestionSets}
          geoReports={geoReports}
          geoSourceDiscoveries={geoSourceDiscoveries}
          indexStatus={indexStatus}
          onBack={() => setMode('list')}
          onDelete={() => selectedProfile && setDeleteTarget(selectedProfile)}
          onEdit={openEditor}
          onRefresh={() => refreshKnowledgeEntries()}
          onStatusChange={setIndexStatus}
          profile={selectedProfile}
          projectId={selectedProfile?.project_id || selectedProfile?.id || ''}
          setEntries={setKnowledgeEntries}
          setTotal={setKnowledgeTotal}
          total={knowledgeTotal}
        />
        {deleteTarget && (
          <DeleteProfileDialog
            confirmation={deleteConfirmation}
            isDeleting={isDeleting}
            onCancel={() => {
              setDeleteTarget(null);
              setDeleteConfirmation('');
            }}
            onChange={setDeleteConfirmation}
            onDelete={handleDeleteProfile}
            profile={deleteTarget}
          />
        )}
      </>
    );
  }

  return (
    <div className="mx-auto flex min-h-full max-w-7xl flex-col gap-8 p-4 pb-16 sm:p-6 md:p-8 lg:p-xl">
      <section className="flex flex-col gap-8 rounded-[20px] bg-[#f7f7f5] p-8 dark:bg-surface-variant/40 md:p-12 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-3xl space-y-3">
          <span className="text-[14px] font-bold tracking-wide text-on-surface-variant/80">
            Knowledge Base
          </span>
          <h1 className="font-heading text-[36px] font-bold leading-tight tracking-tight text-primary">
            企业数字资产引擎
          </h1>
          <p className="text-[16px] leading-relaxed text-on-surface-variant">
            为每个企业建立结构化知识库，沉淀公司信息、产品服务、用户痛点、信任背书、案例与目标关键词。智能助手会优先检索这些本地资料。
          </p>
          <button
            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-secondary px-4 py-2.5 text-[13px] font-bold text-on-secondary transition-colors hover:bg-secondary/90"
            onClick={startKnowledgeIngest}
            type="button"
          >
            <Plus className="h-4 w-4" />
            建立企业知识库
          </button>
        </div>
        <div className="hidden h-[160px] w-[240px] shrink-0 items-center justify-center md:flex">
          <svg viewBox="0 0 200 120" className="h-full w-full text-primary" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
            <path d="M60 20 h80 v80 h-80 z" className="fill-surface" />
            <path d="M70 40 h60 M70 60 h60 M70 80 h40" strokeDasharray="3,3" />
            <path d="M50 30 h10 v70 h-10 z" className="fill-surface" />
            <circle cx="150" cy="30" r="12" className="fill-surface" />
            <path d="M150 42 L150 55" />
          </svg>
        </div>
      </section>

      <div className="flex items-center justify-between">
        <span className="text-[12px] text-on-surface-variant/70">
          真实企业知识库来自本地 SQLite。演示数据请使用 `scripts/seed_demo_knowledge.py --data-dir &lt;dir&gt;` 导入。
        </span>
      </div>

      {profiles.length > 0 ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {profiles.map((profile) => (
          <button
            className="group flex h-[360px] min-w-0 cursor-pointer flex-col gap-4 rounded-2xl bg-[#f7f7f5] p-6 text-left transition-all hover:bg-surface-container dark:bg-surface-variant/45"
            key={profile.id}
            onClick={() => openEnterprise(profile)}
            type="button"
          >
            <div className="flex min-w-0 items-start justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-secondary/10 text-secondary">
                  <Building2 className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="truncate font-heading text-[20px] font-bold text-primary transition-colors group-hover:text-secondary">
                    {profileFieldText(profile, 'short_name') || profileFieldText(profile, 'company_name')}
                  </h3>
                  <p className="mt-0.5 truncate font-mono text-[11px] uppercase tracking-wider text-on-surface-variant">
                    {profileFieldText(profile, 'industry_category') || '未填写行业'}
                  </p>
                </div>
              </div>
              <span className="max-w-[42%] shrink-0 truncate rounded-full border border-outline-variant/40 bg-surface px-2 py-0.5 text-[10px] font-bold uppercase text-on-surface-variant">
                {profileFieldText(profile, 'offerings') || '企业知识库'}
              </span>
            </div>

            <p className="line-clamp-4 min-h-[88px] text-[14px] leading-relaxed text-on-surface-variant">
              {profileFieldText(profile, 'detailed_intro') || profileFieldText(profile, 'offerings') || '暂无企业介绍。'}
            </p>

            <div className="mt-auto grid h-[78px] grid-cols-3 gap-2 rounded-2xl border border-outline-variant/10 bg-white/45 px-4 py-3 text-center dark:bg-surface-variant/40">
              <Metric label="知识条目" value={`${profile.entry_count} 条`} />
              <Metric label="业务区域" value={profileFieldText(profile, 'business_regions') || '未填'} />
              <Metric label="关键词" value={profileFieldText(profile, 'target_keywords') ? '已录入' : '待补充'} accent />
            </div>

            <div className="flex min-w-0 items-center justify-between gap-3 pt-2 font-mono text-[12px]">
              <span className="min-w-0 truncate text-on-surface-variant/60">更新于 {profile.updated_at}</span>
              <span className="inline-flex shrink-0 items-center gap-1 font-bold text-secondary transition-transform group-hover:translate-x-1">
                进入知识库管理
                <ChevronRight className="h-4 w-4" />
              </span>
            </div>
          </button>
        ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-outline-variant/50 bg-[#f7f7f5] p-12 text-center dark:bg-surface-variant/25">
          <Database className="mx-auto mb-4 h-10 w-10 text-secondary" />
          <h2 className="font-heading text-[22px] font-bold text-primary">还没有真实企业知识库</h2>
          <p className="mx-auto mt-2 max-w-2xl text-[14px] leading-relaxed text-on-surface-variant">
            点击“建立企业知识库”录入真实资料，或在开发环境运行测试脚本导入完整演示数据。
          </p>
        </div>
      )}

      {deleteTarget && (
        <DeleteProfileDialog
          confirmation={deleteConfirmation}
          isDeleting={isDeleting}
          onCancel={() => {
            setDeleteTarget(null);
            setDeleteConfirmation('');
          }}
          onChange={setDeleteConfirmation}
          onDelete={handleDeleteProfile}
          profile={deleteTarget}
        />
      )}
    </div>
  );
}

function EnterpriseProfileBuilder({
  error,
  form,
  images,
  isEditing,
  isSaving,
  onBack,
  onChange,
  onImagesChange,
  onSave,
}: {
  error: string | null;
  form: ProfileFormState;
  images: UploadedImageAsset[];
  isEditing: boolean;
  isSaving: boolean;
  onBack: () => void;
  onChange: (key: keyof ProfileFormState, value: string) => void;
  onImagesChange: React.Dispatch<React.SetStateAction<UploadedImageAsset[]>>;
  onSave: () => void;
}) {
  return (
    <div className="mx-auto flex min-h-full max-w-7xl flex-col gap-6 p-4 pb-16 sm:p-6 md:p-8 lg:p-xl">
      <div className="flex flex-col gap-4 border-b border-outline-variant/20 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <button
            className="mb-3 inline-flex items-center gap-2 text-[12px] font-bold uppercase tracking-widest text-secondary transition-colors hover:text-primary"
            onClick={onBack}
            type="button"
          >
            <ArrowLeft className="h-4 w-4" />
            返回知识库
          </button>
          <h1 className="font-heading text-[36px] font-bold leading-tight text-primary">
            {isEditing ? '编辑企业知识库' : '建立企业知识库'}
          </h1>
          <p className="mt-2 max-w-4xl text-[14px] leading-relaxed text-on-surface-variant">
            按字段录入企业资料后，系统会自动拆分为可检索知识条目，并根据目标关键词生成长尾语义词。后续智能助手、文章生成和网页生成都会优先使用这些资料。
          </p>
        </div>
        <button
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-secondary px-5 py-3 text-[13px] font-bold text-on-secondary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
          disabled={!form.company_name.trim() || isSaving}
          onClick={onSave}
          type="button"
        >
          <Database className="h-4 w-4" />
          {isSaving ? '正在保存' : isEditing ? '保存修改' : '建立知识库'}
        </button>
      </div>

      {error && (
        <p className="rounded-xl bg-red-500/10 px-4 py-3 text-[13px] text-red-600 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="grid gap-6">
        {profileSections.map((section) => (
          <section className="rounded-2xl bg-[#f7f7f5] p-6 dark:bg-surface-variant/45" key={section.title}>
            <div className="mb-5 flex flex-col gap-1">
              <h2 className="flex items-center gap-2 font-heading text-[20px] font-bold text-primary">
                <Plus className="h-5 w-5 text-secondary" />
                {section.title}
              </h2>
              <p className="text-[13px] leading-relaxed text-on-surface-variant">
                {section.description}
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {section.title === '图片与关键词' && (
                <div className="md:col-span-2">
                  <ImageUploadField images={images} onImagesChange={onImagesChange} />
                </div>
              )}
              {section.fields.map((field) => {
                const fieldKey = field.key;
                return (
                  <React.Fragment key={fieldKey}>
                    <ProfileField
                      field={field}
                      onChange={(value) => onChange(fieldKey, value)}
                      value={form[fieldKey]}
                    />
                  </React.Fragment>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <div className="rounded-2xl bg-[#f7f7f5] p-5 text-[13px] leading-relaxed text-on-surface-variant dark:bg-surface-variant/45">
        <div className="mb-2 flex items-center gap-2 font-bold text-primary">
          <Sparkles className="h-4 w-4 text-secondary" />
          ChatBox 也可以录入
        </div>
        在智能助手中输入“建立企业知识库”或“补充企业资料”，并按这些字段描述企业，系统会同样写入本地知识库。这里的表单适合一次性完整录入，ChatBox 适合补充和迭代。
      </div>
    </div>
  );
}

function ImageUploadField({
  images,
  onImagesChange,
}: {
  images: UploadedImageAsset[];
  onImagesChange: React.Dispatch<React.SetStateAction<UploadedImageAsset[]>>;
}) {
  const handleUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []) as File[];
    if (!files.length) {
      return;
    }

    const nextImages = files
      .filter((file) => file.type.startsWith('image/'))
      .map((file) => ({
        id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
        name: file.name,
        size: file.size,
        type: file.type,
        previewUrl: URL.createObjectURL(file),
      }));

    onImagesChange((current) => [...current, ...nextImages]);
    event.target.value = '';
  };

  const removeImage = (id: string) => {
    onImagesChange((current) => {
      const removed = current.find((image) => image.id === id);
      if (removed) {
        URL.revokeObjectURL(removed.previewUrl);
      }
      return current.filter((image) => image.id !== id);
    });
  };

  return (
    <div>
      <span className="mb-2 block text-[12px] font-bold text-primary">
        图片上传
      </span>
      <label className="flex min-h-[180px] cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-outline-variant/50 bg-white px-6 py-8 text-center transition-colors hover:border-secondary hover:bg-secondary/5 dark:bg-[#1f1f1f] dark:hover:bg-secondary/10">
        <Upload className="mb-3 h-8 w-8 text-secondary" />
        <span className="text-[14px] font-bold text-primary">上传公司/门店/产品图片</span>
        <span className="mt-2 max-w-2xl text-[13px] leading-relaxed text-on-surface-variant">
          支持门头照、全景图、产品图片、合作商墙、企业形象墙等。建议与高德、美团、抖音展示图片保持一致。
        </span>
        <span className="mt-3 rounded-full bg-secondary/10 px-3 py-1 text-[12px] font-bold text-secondary">
          选择图片
        </span>
        <input
          accept="image/*"
          className="sr-only"
          multiple
          onChange={handleUpload}
          type="file"
        />
      </label>

      {images.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {images.map((image) => (
            <div className="group relative overflow-hidden rounded-xl border border-outline-variant/30 bg-white dark:bg-[#1f1f1f]" key={image.id}>
              <img
                alt={image.name}
                className="aspect-video w-full object-cover"
                src={image.previewUrl}
              />
              <button
                className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
                onClick={() => removeImage(image.id)}
                title="移除图片"
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
              <div className="p-3">
                <p className="truncate text-[12px] font-bold text-primary">{image.name}</p>
                <p className="mt-1 text-[11px] text-on-surface-variant/70">{formatFileSize(image.size)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function KnowledgeDetail({
  entries,
  geoProject,
  geoArticleDrafts,
  geoWorkflowState,
  geoQuestionSets,
  geoReports,
  geoSourceDiscoveries,
  indexStatus,
  onBack,
  onDelete,
  onEdit,
  onRefresh,
  onStatusChange,
  profile,
  projectId,
  setEntries,
  setTotal,
  total,
}: {
  entries: GeoAgentKnowledgeEntry[];
  geoProject: GeoAgentGeoProject | null;
  geoArticleDrafts: Record<'doubao' | 'deepseek', { consulting: GeoAgentGeoArticleDraft | null; review: GeoAgentGeoArticleDraft | null }>;
  geoWorkflowState: GeoAgentWorkflowState | null;
  geoQuestionSets: Record<'doubao' | 'deepseek', GeoAgentGeoQuestionSet | null>;
  geoReports: Record<'doubao' | 'deepseek', GeoAgentGeoReport | null>;
  geoSourceDiscoveries: Record<'doubao' | 'deepseek', GeoAgentGeoSourceDiscovery | null>;
  indexStatus: GeoAgentKnowledgeIndexStatus | null;
  onBack: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onRefresh: () => Promise<void>;
  onStatusChange: (status: GeoAgentKnowledgeIndexStatus | null) => void;
  profile: GeoAgentEnterpriseProfile | null;
  projectId: string;
  setEntries: React.Dispatch<React.SetStateAction<GeoAgentKnowledgeEntry[]>>;
  setTotal: React.Dispatch<React.SetStateAction<number>>;
  total: number;
}) {
  const enterpriseName = profileFieldText(profile, 'short_name') || profileFieldText(profile, 'company_name') || '企业知识库';
  const healthReport = buildKnowledgeHealthReport(profile, entries, indexStatus);
  const geoStages = buildGeoStagesFromWorkflow(geoWorkflowState)
    ?? buildGeoStagesFromProject(geoProject, geoReports, geoQuestionSets, geoSourceDiscoveries, geoArticleDrafts);
  const initialKeywords = geoProject?.initial_keywords ?? [];
  const [isUploading, setIsUploading] = useState(false);
  const [isReindexing, setIsReindexing] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [detailEntry, setDetailEntry] = useState<GeoAgentKnowledgeEntry | null>(null);
  const [isMarkdownOpen, setIsMarkdownOpen] = useState(false);
  const [isEntriesOpen, setIsEntriesOpen] = useState(false);
  const [retrievalQuery, setRetrievalQuery] = useState('');
  const [retrievalResults, setRetrievalResults] = useState<GeoAgentKnowledgeEntry[]>([]);
  const [isTestingRetrieval, setIsTestingRetrieval] = useState(false);
  const uploadInputId = `knowledge-upload-${projectId || 'current'}`;

  const handleDocumentUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []) as File[];
    event.target.value = '';
    if (!files.length || !projectId) {
      return;
    }
    if (!window.geoAgent?.createKnowledgeDraft && !window.geoAgent?.createKnowledgeDraftStream) {
      setUploadError('桌面端主进程接口尚未刷新，请完全关闭并重新启动 Electron 后再上传。');
      return;
    }
    setIsUploading(true);
    setUploadError(null);
    try {
      const assets = await Promise.all(files.map(async (file) => ({
        filename: file.name,
        content_type: file.type || null,
        content_base64: await fileToBase64(file),
      })));
      const draftPayload = {
        message: `请根据上传附件生成「${enterpriseName}」企业知识库更新草稿。`,
        intent: 'update',
        project_id: projectId,
        skill_id: 'knowledge-base-ingest',
        assets,
      };
      let conversationId: string | null = null;
      if (window.geoAgent.createKnowledgeDraftStream) {
        const finalEvent = await window.geoAgent.createKnowledgeDraftStream(draftPayload, () => undefined);
        if (finalEvent.type === 'error') {
          throw new Error(finalEvent.error || '知识库更新草稿生成失败。');
        }
        conversationId = finalEvent.conversation_id || finalEvent.draft?.conversation_id || null;
      } else if (window.geoAgent.createKnowledgeDraft) {
        const draft = await window.geoAgent.createKnowledgeDraft(draftPayload);
        conversationId = draft.conversation_id || null;
      }
      setUploadError('已生成知识库更新草稿，请在智能助手中确认后写入当前知识库。');
      window.dispatchEvent(new CustomEvent('geo-agent-open-view', { detail: { view: 'agent' } }));
      window.setTimeout(() => {
        if (conversationId) {
          window.dispatchEvent(new CustomEvent('geo-agent-open-conversation', { detail: { id: conversationId } }));
          return;
        }
        window.dispatchEvent(new CustomEvent('geo-agent-start-knowledge-ingest', {
          detail: {
            intent: 'update',
            projectId,
            message: `请根据上传附件生成「${enterpriseName}」企业知识库更新草稿。`,
          },
        }));
      }, 80);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : '文档上传或解析失败。');
    } finally {
      setIsUploading(false);
    }
  };

  const handleRetrievalTest = async () => {
    if (!projectId || !retrievalQuery.trim() || !window.geoAgent?.searchKnowledge) {
      return;
    }
    setIsTestingRetrieval(true);
    try {
      const response = await window.geoAgent.searchKnowledge(retrievalQuery, projectId, 6);
      setRetrievalResults(response.entries || []);
    } finally {
      setIsTestingRetrieval(false);
    }
  };

  const handleReparseAsset = async (assetId: string) => {
    if (!window.geoAgent?.reparseKnowledgeAsset) return;
    onStatusChange(await window.geoAgent.reparseKnowledgeAsset(assetId));
    await onRefresh();
  };

  const handleDeleteAsset = async (assetId: string) => {
    if (!window.geoAgent?.deleteKnowledgeAsset) return;
    if (!window.confirm('确认删除这个源文件及其关联知识片段吗？')) return;
    onStatusChange(await window.geoAgent.deleteKnowledgeAsset(assetId));
    await onRefresh();
  };

  const handleReindex = async () => {
    if (!projectId || !window.geoAgent?.reindexKnowledge) {
      return;
    }
    setIsReindexing(true);
    try {
      onStatusChange(await window.geoAgent.reindexKnowledge(projectId));
      await onRefresh();
    } finally {
      setIsReindexing(false);
    }
  };

  const startPhaseTwo = () => {
    if (!projectId) {
      return;
    }
    window.dispatchEvent(new CustomEvent('geo-agent-open-view', { detail: { view: 'agent' } }));
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('geo-agent-start-phase-two', { detail: { projectId } }));
    }, 80);
  };

  return (
    <div className="mx-auto flex min-h-full max-w-7xl flex-col gap-6 p-4 pb-16 sm:p-6 md:p-8 lg:p-xl">
      <div className="flex flex-col gap-4 border-b border-outline-variant/20 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <button
            className="mb-3 inline-flex items-center gap-2 text-[12px] font-bold uppercase tracking-widest text-secondary transition-colors hover:text-primary"
            onClick={onBack}
            type="button"
          >
            <ArrowLeft className="h-4 w-4" />
            返回企业列表
          </button>
          <h1 className="font-heading text-[36px] font-bold leading-tight text-primary">
            {enterpriseName} <span className="text-[24px] font-medium text-on-surface-variant/40">• GEO 资产体检</span>
          </h1>
          <p className="mt-2 max-w-4xl text-[14px] leading-relaxed text-on-surface-variant">
            默认展示知识库健康评分、缺失项、阶段进度和资产状态；完整企业资料与原始知识条目可在弹窗中查看。
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#f7f7f5] px-5 py-3 text-[13px] font-bold text-primary transition-colors hover:bg-surface-container dark:bg-surface-variant/45"
            onClick={onEdit}
            type="button"
          >
            <Edit3 className="h-4 w-4" />
            编辑知识库
          </button>
          <label
            className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#f7f7f5] px-5 py-3 text-[13px] font-bold text-primary transition-colors hover:bg-surface-container dark:bg-surface-variant/45"
            htmlFor={uploadInputId}
          >
            <Upload className="h-4 w-4" />
            上传资料补充
          </label>
          <button
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#f7f7f5] px-5 py-3 text-[13px] font-bold text-primary transition-colors hover:bg-surface-container dark:bg-surface-variant/45"
            onClick={() => setIsMarkdownOpen(true)}
            type="button"
          >
            <FileText className="h-4 w-4" />
            查看 Markdown 档案
          </button>
          <button
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#f7f7f5] px-5 py-3 text-[13px] font-bold text-primary transition-colors hover:bg-surface-container dark:bg-surface-variant/45"
            onClick={() => setIsEntriesOpen(true)}
            type="button"
          >
            <Eye className="h-4 w-4" />
            查看知识条目
          </button>
          <button
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-transparent px-4 py-3 text-[13px] font-bold text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-300"
            onClick={onDelete}
            type="button"
          >
            <Trash2 className="h-4 w-4" />
            删除知识库
          </button>
        </div>
      </div>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[0.95fr_1.4fr]">
        <div className="rounded-[22px] bg-[#f7f7f5] p-6 dark:bg-surface-variant/45">
          <span className="text-[12px] font-bold uppercase tracking-widest text-on-surface-variant/70">Knowledge Health</span>
          <div className="mt-4 flex items-end gap-3">
            <span className="font-heading text-[64px] font-black leading-none text-primary">{healthReport.score}</span>
            <span className="pb-2 font-mono text-[16px] font-bold text-on-surface-variant">/100</span>
          </div>
          <p className="mt-4 text-[15px] font-bold text-primary">{healthReport.verdict}</p>
          <p className="mt-2 text-[13px] leading-relaxed text-on-surface-variant">
            评分基于企业资料完整度、EEAT、关键词、RAG 索引和排行榜问题池准备度本地计算，仅用于指导下一步补充。
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {healthReport.dimensions.map((dimension) => (
            <div key={dimension.key}>
              <HealthDimensionCard dimension={dimension} />
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <SummaryCard icon={Database} label="知识条目" value={`${total} 条`} />
        <SummaryCard icon={FileText} label="已索引" value={`${indexStatus?.indexed ?? 0} 条`} />
        <SummaryCard icon={AlertCircle} label="待处理/失败" value={`${indexStatus?.pending ?? 0}/${indexStatus?.failed ?? 0}`} />
        <SummaryCard icon={Image} label="文档资产" value={`${indexStatus?.asset_count ?? 0} 个`} />
        <SummaryCard icon={Target} label="关键词状态" value={profileFieldText(profile, 'target_keywords') ? '已录入' : '待补充'} />
      </div>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-2xl bg-[#f7f7f5] p-5 dark:bg-surface-variant/45">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-heading text-[20px] font-bold text-primary">阶段一输出</h2>
              <p className="mt-1 text-[13px] leading-relaxed text-on-surface-variant">
                这里读取 GEO 项目状态层，不会写回企业事实知识库。
              </p>
            </div>
            <span className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-bold ${geoProject?.knowledge_base_ready ? 'bg-secondary/12 text-secondary' : 'bg-amber-500/12 text-amber-700 dark:text-amber-300'}`}>
              {geoProject?.knowledge_base_ready ? '可启动阶段二' : '继续采集'}
            </span>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-white/60 p-4 dark:bg-[#1f1f1f]">
              <span className="text-[11px] font-bold uppercase tracking-widest text-on-surface-variant/70">Current Phase</span>
              <p className="mt-2 text-[15px] font-bold text-primary">
                {formatCurrentPhase(geoProject?.current_phase)}
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-on-surface-variant">
                {geoProject?.current_phase === 'ready_for_check'
                  ? '知识库已具备基础资料和可检索索引，下一步可构建 AI 核心问题池。'
                  : '继续补充企业资料、附件和索引状态，避免后续自查缺少事实依据。'}
              </p>
              {geoProject?.current_phase === 'ready_for_check' && (
                <button
                  className="mt-3 inline-flex items-center gap-2 rounded-xl bg-secondary px-3 py-2 text-[12px] font-bold text-on-secondary transition-opacity hover:opacity-90"
                  onClick={startPhaseTwo}
                  type="button"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  启动问题池构建
                </button>
              )}
            </div>
            <div className="rounded-xl bg-white/60 p-4 dark:bg-[#1f1f1f]">
              <span className="text-[11px] font-bold uppercase tracking-widest text-on-surface-variant/70">Platforms</span>
              <p className="mt-2 truncate text-[15px] font-bold text-primary">
                {(geoProject?.platforms ?? ['doubao', 'deepseek']).join(' / ')}
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-on-surface-variant">
                阶段二会围绕目标平台生成排行榜/推荐类用户问题池，后续进入信源发现。
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-[#f7f7f5] p-5 dark:bg-surface-variant/45">
          <h2 className="font-heading text-[20px] font-bold text-primary">初始预设关键词</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-on-surface-variant">
            优先使用用户录入关键词；没有关键词时按地区、行业和企业主体生成，作为 GEO 项目的阶段一输出。
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {initialKeywords.length > 0 ? (
              initialKeywords.map((keyword) => (
                <span className="max-w-full truncate rounded-full bg-white/70 px-3 py-1.5 text-[12px] font-bold text-primary dark:bg-[#1f1f1f]" key={keyword}>
                  {keyword}
                </span>
              ))
            ) : (
              <span className="rounded-xl bg-white/60 px-4 py-3 text-[13px] text-on-surface-variant dark:bg-[#1f1f1f]">
                暂无初始关键词，请在企业资料中补充目标关键词或业务区域。
              </span>
            )}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <label className="flex min-h-[150px] cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-outline-variant/50 bg-[#f7f7f5] px-6 py-8 text-center transition-colors hover:border-secondary hover:bg-secondary/5 dark:bg-surface-variant/35">
          <Upload className="mb-3 h-7 w-7 text-secondary" />
          <span className="text-[14px] font-bold text-primary">
            {isUploading ? '正在生成更新草稿...' : '上传 Markdown / PDF / Word 文档'}
          </span>
          <span className="mt-2 max-w-2xl text-[13px] leading-relaxed text-on-surface-variant">
            文档会先生成知识库更新草稿，确认后再写入当前企业并建立本地 FTS5 全文检索索引。
          </span>
          <input
            accept=".md,.markdown,.txt,.pdf,.doc,.docx,text/markdown,text/plain,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="sr-only"
            disabled={isUploading}
            id={uploadInputId}
            multiple
            onChange={handleDocumentUpload}
            type="file"
          />
          {uploadError && <span className="mt-3 text-[12px] font-semibold text-secondary">{uploadError}</span>}
        </label>

        <div className="min-w-0 rounded-2xl bg-[#f7f7f5] p-5 dark:bg-surface-variant/45">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-heading text-[18px] font-bold text-primary">本地 RAG 索引</h2>
              <p className="mt-1 truncate text-[12px] leading-relaxed text-on-surface-variant">
                {indexStatus
                  ? `全文检索：${indexStatus.vector_backend} / Embedding：${indexStatus.embedding_backend}`
                  : '等待索引状态'}
              </p>
            </div>
            <button
              className="inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl bg-secondary px-3 py-2 text-[12px] font-bold text-on-secondary transition-opacity hover:opacity-90 disabled:opacity-50"
              disabled={isReindexing}
              onClick={handleReindex}
              type="button"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isReindexing ? 'animate-spin' : ''}`} />
              重建索引
            </button>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <Metric label="待处理" value={`${indexStatus?.pending ?? 0}`} />
            <Metric label="已索引" value={`${indexStatus?.indexed ?? 0}`} accent />
            <Metric label="失败" value={`${indexStatus?.failed ?? 0}`} />
          </div>
          {indexStatus?.assets && indexStatus.assets.length > 0 && (
            <div className="mt-4 space-y-2">
              {indexStatus.assets.slice(0, 4).map((asset) => (
                <div className="rounded-xl bg-white/55 px-3 py-2 text-[12px] dark:bg-[#1f1f1f]" key={asset.id}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate font-semibold text-primary">{asset.filename}</span>
                    <span className={`shrink-0 truncate ${asset.status === 'failed' ? 'text-red-600' : 'text-secondary'}`}>
                      {asset.status} / {asset.embedding_status || 'not-configured'}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-on-surface-variant">
                    <span>{formatFileSize(asset.file_size || 0)}</span>
                    <div className="flex gap-2">
                      <button className="font-bold text-secondary hover:opacity-80" onClick={() => handleReparseAsset(asset.id)} type="button">
                        重新解析
                      </button>
                      <button className="font-bold text-red-600 hover:opacity-80" onClick={() => handleDeleteAsset(asset.id)} type="button">
                        删除
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 rounded-xl bg-white/55 p-3 dark:bg-[#1f1f1f]">
            <div className="flex gap-2">
              <input
                className="min-w-0 flex-1 rounded-lg border border-outline-variant/40 bg-white px-3 py-2 text-[12px] text-primary outline-none focus:border-secondary dark:bg-surface"
                onChange={(event) => setRetrievalQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleRetrievalTest();
                }}
                placeholder="输入一句问题测试混合检索"
                value={retrievalQuery}
              />
              <button
                className="shrink-0 rounded-lg bg-primary px-3 py-2 text-[12px] font-bold text-on-primary disabled:opacity-50"
                disabled={isTestingRetrieval || !retrievalQuery.trim()}
                onClick={handleRetrievalTest}
                type="button"
              >
                {isTestingRetrieval ? '检索中' : '测试'}
              </button>
            </div>
            {retrievalResults.length > 0 && (
              <div className="mt-3 space-y-2">
                {retrievalResults.map((entry) => (
                  <button
                    className="block w-full rounded-lg bg-white/70 p-2 text-left text-[12px] hover:bg-white dark:bg-surface-variant/45"
                    key={entry.id}
                    onClick={() => setDetailEntry(entry)}
                    type="button"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-bold text-primary">{entry.source_filename || entry.title}</span>
                      <span className="shrink-0 text-secondary">{entry.retrieval_source || 'fts'} {entry.score ? entry.score.toFixed(2) : ''}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-on-surface-variant">{entry.content}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-2xl bg-[#f7f7f5] p-5 dark:bg-surface-variant/45">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="font-heading text-[20px] font-bold text-primary">待补充内容</h2>
            <span className="rounded-full bg-white/65 px-3 py-1 text-[11px] font-bold text-on-surface-variant dark:bg-[#1f1f1f]">
              {healthReport.gaps.length} 项
            </span>
          </div>
          {healthReport.gaps.length > 0 ? (
            <div className="space-y-2">
              {healthReport.gaps.slice(0, 8).map((gap) => (
                <div key={gap.label}>
                  <GapItemCard
                    gap={gap}
                    onEdit={onEdit}
                    onUpload={() => document.getElementById(uploadInputId)?.click()}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl bg-white/55 p-4 text-[13px] leading-relaxed text-on-surface-variant dark:bg-[#1f1f1f]">
              当前基础资料较完整，可以进入排行榜问题池与信源发现流程。
            </div>
          )}
        </div>

        <div className="rounded-2xl bg-[#f7f7f5] p-5 dark:bg-surface-variant/45">
          <h2 className="mb-4 font-heading text-[20px] font-bold text-primary">GEO 优化阶段</h2>
          <div className="space-y-2">
            {geoStages.map((stage, index) => (
              <div key={stage.label}>
                <GeoStageRow index={index + 1} stage={stage} />
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#f7f7f5] p-5 dark:bg-surface-variant/45">
        <div>
          <h2 className="font-heading text-[18px] font-bold text-primary">完整内容查看</h2>
          <p className="mt-1 text-[13px] text-on-surface-variant">
            原始知识条目和企业档案仍完整保留，只是不在体检页主界面铺开。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="rounded-xl bg-white/70 px-4 py-2.5 text-[13px] font-bold text-primary hover:bg-white dark:bg-[#1f1f1f]" onClick={() => setIsMarkdownOpen(true)} type="button">
            查看 Markdown 企业档案
          </button>
          <button className="rounded-xl bg-secondary px-4 py-2.5 text-[13px] font-bold text-on-secondary hover:opacity-90" onClick={() => setIsEntriesOpen(true)} type="button">
            查看 {entries.length} 条知识条目
          </button>
        </div>
      </div>

      {isMarkdownOpen && profile && (
        <MarkdownProfileDialog markdown={buildProfileMarkdown(profile)} onClose={() => setIsMarkdownOpen(false)} title={`${enterpriseName} Markdown 企业档案`} />
      )}
      {isEntriesOpen && (
        <KnowledgeEntriesDialog
          entries={entries}
          onClose={() => setIsEntriesOpen(false)}
          onSelectEntry={setDetailEntry}
        />
      )}
      {detailEntry && (
        <KnowledgeEntryDialog entry={detailEntry} onClose={() => setDetailEntry(null)} />
      )}
    </div>
  );
}

function DeleteProfileDialog({
  confirmation,
  isDeleting,
  onCancel,
  onChange,
  onDelete,
  profile,
}: {
  confirmation: string;
  isDeleting: boolean;
  onCancel: () => void;
  onChange: (value: string) => void;
  onDelete: () => void;
  profile: GeoAgentEnterpriseProfile;
}) {
  const canDelete = confirmation === DELETE_CONFIRMATION_TEXT && !isDeleting;
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 px-4 py-8">
      <div className="w-full max-w-[560px] rounded-2xl bg-white p-6 shadow-2xl dark:bg-[#1f1f1f]">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-red-500/10 text-red-600 dark:text-red-300">
            <Trash2 className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="font-heading text-[22px] font-bold text-primary">删除企业知识库</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-on-surface-variant">
              此操作会永久删除 <strong className="text-primary">{profileFieldText(profile, 'short_name') || profileFieldText(profile, 'company_name')}</strong> 的企业资料和全部知识条目，无法撤销。
            </p>
          </div>
        </div>
        <label className="mt-5 block">
          <span className="mb-2 block text-[12px] font-bold text-primary">
            请输入 `{DELETE_CONFIRMATION_TEXT}` 以确认删除
          </span>
          <input
            className="block w-full min-w-0 rounded-xl border border-outline-variant/40 bg-[#f7f7f5] px-4 py-3 text-[14px] text-primary outline-none transition-colors focus:border-red-500 dark:bg-[#111]"
            onChange={(event) => onChange(event.target.value)}
            value={confirmation}
          />
        </label>
        <div className="mt-6 flex justify-end gap-3">
          <button
            className="rounded-xl bg-[#f7f7f5] px-4 py-2.5 text-[13px] font-bold text-primary transition-colors hover:bg-surface-container dark:bg-surface-variant/45"
            onClick={onCancel}
            type="button"
          >
            取消
          </button>
          <button
            className="rounded-xl bg-red-600 px-4 py-2.5 text-[13px] font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!canDelete}
            onClick={onDelete}
            type="button"
          >
            {isDeleting ? '正在删除' : '确认删除'}
          </button>
        </div>
      </div>
    </div>
  );
}

function HealthDimensionCard({ dimension }: { dimension: KnowledgeHealthDimension }) {
  return (
    <div className="min-w-0 rounded-2xl bg-[#f7f7f5] p-4 dark:bg-surface-variant/45">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[13px] font-bold text-primary">{dimension.label}</h3>
          <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-on-surface-variant">{dimension.reason}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 font-mono text-[12px] font-black ${statusClassName(dimension.status)}`}>
          {dimension.score}
        </span>
      </div>
      <div className="mt-3 h-1.5 rounded-full bg-outline-variant/20">
        <div className="h-full rounded-full bg-secondary" style={{ width: `${dimension.score}%` }} />
      </div>
      {dimension.missingItems.length > 0 && (
        <p className="mt-2 truncate text-[11px] text-on-surface-variant/70">
          待补充：{dimension.missingItems.join('、')}
        </p>
      )}
    </div>
  );
}

function GapItemCard({
  gap,
  onEdit,
  onUpload,
}: {
  gap: KnowledgeGapItem;
  onEdit: () => void;
  onUpload: () => void;
}) {
  const priorityLabel = gap.priority === 'high' ? '高优先级' : gap.priority === 'medium' ? '中优先级' : '可补充';
  return (
    <div className="rounded-xl bg-white/60 p-3 dark:bg-[#1f1f1f]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[13px] font-bold text-primary">{gap.label}</h3>
          <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-on-surface-variant">{gap.actionPrompt}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${gap.priority === 'high' ? 'bg-red-500/10 text-red-600 dark:text-red-300' : 'bg-secondary/10 text-secondary'}`}>
          {priorityLabel}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="rounded-lg bg-secondary/10 px-3 py-1.5 text-[12px] font-bold text-secondary hover:bg-secondary/15" onClick={onEdit} type="button">
          去编辑
        </button>
        <button className="rounded-lg bg-surface-container px-3 py-1.5 text-[12px] font-bold text-primary hover:bg-white dark:hover:bg-[#2a2a2a]" onClick={onUpload} type="button">
          上传附件补充
        </button>
      </div>
    </div>
  );
}

function GeoStageRow({ index, stage }: { index: number; stage: GeoStageStatus }) {
  const isUsable = stage.status === '可用';
  const isProgress = stage.status === '进行中';
  const isDeferred = stage.status === '已暂缓' || stage.status === '待重试';
  return (
    <div className="flex items-start gap-3 rounded-xl bg-white/60 px-3 py-3 dark:bg-[#1f1f1f]">
      <div className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-black ${isUsable ? 'bg-secondary text-on-secondary' : isProgress ? 'bg-secondary/15 text-secondary' : isDeferred ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'bg-surface-container text-on-surface-variant'}`}>
        {isUsable ? <CheckCircle2 className="h-4 w-4" /> : index}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <h3 className="truncate text-[13px] font-bold text-primary">{stage.label}</h3>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${isProgress ? 'bg-secondary/10 text-secondary' : isDeferred ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'bg-surface-container text-on-surface-variant'}`}>
            {stage.status}
          </span>
        </div>
        <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-on-surface-variant">{stage.description}</p>
      </div>
    </div>
  );
}

function MarkdownProfileDialog({
  markdown,
  onClose,
  title,
}: {
  markdown: string;
  onClose: () => void;
  title: string;
}) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/35 px-4 py-8" onClick={onClose} role="presentation">
      <div className="flex max-h-[86vh] w-full max-w-4xl flex-col rounded-2xl bg-white p-5 shadow-2xl dark:bg-[#1f1f1f]" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-outline-variant/20 pb-4">
          <div className="min-w-0">
            <h2 className="font-heading text-[20px] font-bold leading-snug text-primary">{title}</h2>
            <p className="mt-1 text-[12px] text-on-surface-variant">由结构化企业 profile 实时生成，方便核对完整档案。</p>
          </div>
          <button className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container hover:text-primary" onClick={onClose} type="button">
            <X className="h-4 w-4" />
          </button>
        </div>
        <pre className="mt-4 min-h-0 overflow-y-auto whitespace-pre-wrap rounded-xl bg-[#f7f7f5] p-4 font-mono text-[12px] leading-relaxed text-primary dark:bg-[#111]">
          {markdown}
        </pre>
      </div>
    </div>
  );
}

function KnowledgeEntriesDialog({
  entries,
  onClose,
  onSelectEntry,
}: {
  entries: GeoAgentKnowledgeEntry[];
  onClose: () => void;
  onSelectEntry: (entry: GeoAgentKnowledgeEntry) => void;
}) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/35 px-4 py-8" onClick={onClose} role="presentation">
      <div className="flex max-h-[86vh] w-full max-w-5xl flex-col rounded-2xl bg-white p-5 shadow-2xl dark:bg-[#1f1f1f]" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-outline-variant/20 pb-4">
          <div>
            <h2 className="font-heading text-[20px] font-bold text-primary">原始知识条目</h2>
            <p className="mt-1 text-[12px] text-on-surface-variant">共 {entries.length} 条，点击单条可查看完整内容。</p>
          </div>
          <button className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container hover:text-primary" onClick={onClose} type="button">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 grid min-h-0 gap-3 overflow-y-auto pr-1 md:grid-cols-2">
          {entries.length > 0 ? entries.map((entry) => (
            <button className="min-w-0 rounded-xl bg-[#f7f7f5] p-4 text-left transition-colors hover:bg-surface-container dark:bg-surface-variant/45" key={entry.id} onClick={() => onSelectEntry(entry)} type="button">
              <div className="flex items-start justify-between gap-3">
                <h3 className="line-clamp-2 font-heading text-[15px] font-bold text-primary">{entry.title}</h3>
                <span className="shrink-0 rounded-full bg-secondary/10 px-2 py-0.5 font-mono text-[10px] font-bold text-secondary">{entry.embedding_status}</span>
              </div>
              <p className="mt-2 line-clamp-3 text-[12px] leading-relaxed text-on-surface-variant">{entry.content}</p>
              <span className="mt-3 block truncate font-mono text-[10px] text-on-surface-variant/60">{entry.source_type} · chunk {entry.chunk_index}</span>
            </button>
          )) : (
            <div className="rounded-xl border border-dashed border-outline-variant/50 p-8 text-center text-[13px] text-on-surface-variant md:col-span-2">
              暂无知识条目。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function KnowledgeEntryDialog({
  entry,
  onClose,
}: {
  entry: GeoAgentKnowledgeEntry;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/35 px-4 py-8"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[86vh] w-full max-w-3xl flex-col rounded-2xl bg-white p-5 shadow-2xl dark:bg-[#1f1f1f]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-outline-variant/20 pb-4">
          <div className="min-w-0">
            <h2 className="font-heading text-[20px] font-bold leading-snug text-primary">
              {entry.title}
            </h2>
            <p className="mt-2 truncate font-mono text-[11px] text-on-surface-variant/70">
              {entry.source_type} · chunk {entry.chunk_index} · {entry.created_at}
            </p>
          </div>
          <button
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container hover:text-primary"
            onClick={onClose}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 min-h-0 overflow-y-auto pr-1">
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-on-surface-variant">
            {entry.content}
          </p>
          {entry.error_message && (
            <div className="mt-4 rounded-xl bg-red-500/10 p-3 text-[12px] font-semibold text-red-600 dark:text-red-300">
              {entry.error_message}
            </div>
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-2 border-t border-outline-variant/20 pt-4">
          <span className="rounded-full bg-secondary/10 px-3 py-1 text-[11px] font-bold text-secondary">
            {entry.embedding_status}
          </span>
          <span className="max-w-full truncate rounded-full bg-surface-container px-3 py-1 text-[11px] font-bold text-on-surface-variant">
            {entry.id}
          </span>
        </div>
      </div>
    </div>
  );
}

function ProfileField({
  field,
  onChange,
  value,
}: {
  field: {
    key: keyof ProfileFormState;
    label: string;
    placeholder: string;
    type?: 'input' | 'textarea';
    rows?: number;
    required?: boolean;
  };
  onChange: (value: string) => void;
  value: string;
}) {
  const className = 'w-full rounded-xl border border-outline-variant/40 bg-white px-4 py-3 text-[14px] leading-relaxed text-primary outline-none transition-colors placeholder:text-on-surface-variant/45 focus:border-secondary dark:bg-[#1f1f1f]';
  return (
    <label className={field.type === 'textarea' ? 'md:col-span-2' : ''}>
      <span className="mb-2 block text-[12px] font-bold text-primary">
        {field.label}
        {field.required && <span className="ml-1 text-secondary">*</span>}
      </span>
      {field.type === 'textarea' ? (
        <textarea
          className={`${className} resize-y`}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.placeholder}
          rows={field.rows ?? 4}
          value={value}
        />
      ) : (
        <input
          className={className}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.placeholder}
          value={value}
        />
      )}
    </label>
  );
}

function Metric({ accent, label, value }: { accent?: boolean; label: string; value: string }) {
  return (
    <div className="min-w-0">
      <span className="block truncate text-[11px] font-medium text-on-surface-variant">{label}</span>
      <span className={`mt-0.5 block truncate font-mono text-[14px] font-black ${accent ? 'text-secondary' : 'text-primary'}`}>
        {value}
      </span>
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl bg-[#f7f7f5] p-5 dark:bg-surface-variant/45">
      <Icon className="mb-3 h-5 w-5 text-secondary" />
      <span className="block truncate text-[11px] uppercase tracking-wider text-on-surface-variant/70">{label}</span>
      <span className="mt-1 block truncate font-mono text-[22px] font-black text-primary">{value}</span>
    </div>
  );
}

function buildKnowledgeHealthReport(
  profile: GeoAgentEnterpriseProfile | null,
  entries: GeoAgentKnowledgeEntry[],
  indexStatus: GeoAgentKnowledgeIndexStatus | null
): KnowledgeHealthReport {
  const profileData = profile ?? ({} as GeoAgentEnterpriseProfile);
  const scoreFieldGroup = (fields: Array<keyof GeoAgentEnterpriseProfile>) => {
    if (!fields.length) {
      return 0;
    }
    const filled = fields.filter((field) => hasText(profileFieldText(profileData, String(field)))).length;
    return Math.round((filled / fields.length) * 100);
  };

  const dimensions: KnowledgeHealthDimension[] = [
    makeDimension({
      key: 'identity',
      label: '基础资料完整度',
      score: scoreFieldGroup(['company_name', 'short_name', 'industry_category', 'detailed_address', 'business_regions', 'contact_info']),
      weight: 0.18,
      reason: '企业实体、行业、业务和区域是 GEO 召回的基础锚点。',
      missingItems: missingLabels(profileData, [
        ['company_name', '公司名称'],
        ['industry_category', '所属行业分类'],
        ['detailed_address', '详细经营地址'],
        ['business_regions', '业务区域'],
        ['contact_info', '联系方式'],
      ]),
      recommendedAction: '补齐公司身份、主营业务和服务区域。',
    }),
    makeDimension({
      key: 'service',
      label: '产品/服务结构化程度',
      score: scoreFieldGroup(['offerings', 'associated_brands', 'target_audiences', 'core_advantages']),
      weight: 0.16,
      reason: '产品分类、卖点和价格区间决定后续文章与榜单回答的可信度。',
      missingItems: missingLabels(profileData, [
        ['offerings', '产品与服务项目'],
        ['associated_brands', '关联/代理品牌'],
        ['target_audiences', '目标客户/适用人群'],
        ['core_advantages', '核心优势'],
      ]),
      recommendedAction: '按服务分类补充卖点、套餐、价格和差异化优势。',
    }),
    makeDimension({
      key: 'pain',
      label: '用户痛点与场景覆盖',
      score: scoreFieldGroup(['user_pain_points', 'current_pain_points', 'detailed_intro']),
      weight: 0.14,
      reason: '用户画像和真实场景越清楚，模型越容易生成可推荐的回答。',
      missingItems: missingLabels(profileData, [
        ['user_pain_points', '用户痛点'],
        ['current_pain_points', '目前痛点/现状'],
        ['detailed_intro', '企业详细介绍'],
      ]),
      recommendedAction: '补充用户画像、决策顾虑、使用场景和当前获客问题。',
    }),
    makeDimension({
      key: 'eeat',
      label: 'EEAT 信任背书',
      score: scoreFieldGroup(['trust_endorsements', 'proven_cases', 'official_website', 'official_media']),
      weight: 0.18,
      reason: '资质、授权、案例和官方信源是进入推荐榜单的重要支撑。',
      missingItems: missingLabels(profileData, [
        ['trust_endorsements', '信任背书'],
        ['proven_cases', '客户案例'],
        ['official_website', '官方网站'],
        ['official_media', '官方自媒体'],
      ]),
      recommendedAction: '补充资质荣誉、客户案例、媒体账号和官网信源。',
    }),
    makeDimension({
      key: 'keywords',
      label: '关键词与长尾词覆盖',
      score: Math.min(100, (keywordCount(profileFieldText(profileData, 'target_keywords')) >= 3 ? 70 : keywordCount(profileFieldText(profileData, 'target_keywords')) * 25) + (hasText(profileData.generated_long_tail_keywords) ? 30 : 0)),
      weight: 0.14,
      reason: '目标关键词和长尾问题决定阶段二自查与阶段五内容矩阵方向。',
      missingItems: [
        ...(keywordCount(profileFieldText(profileData, 'target_keywords')) > 0 ? [] : ['目标关键词']),
        ...(hasText(profileData.generated_long_tail_keywords) ? [] : ['长尾语义词']),
      ],
      recommendedAction: '补充地区 + 行业 + 主体关键词，并生成长尾用户问题。',
    }),
    makeDimension({
      key: 'rag',
      label: 'RAG 检索状态',
      score: buildRagScore(entries, indexStatus),
      weight: 0.12,
      reason: '知识条目写入本地全文检索索引后，智能助手和文章生成才能稳定引用企业资料。',
      missingItems: [
        ...(entries.length > 0 ? [] : ['知识条目']),
        ...((indexStatus?.failed ?? 0) > 0 ? ['失败条目'] : []),
        ...((indexStatus?.pending ?? 0) > 0 ? ['待处理条目'] : []),
      ],
      recommendedAction: '上传资料并重建索引，确保条目进入本地检索库。',
    }),
    makeDimension({
      key: 'geo_ready',
      label: '排行榜问题池准备度',
      score: Math.round((scoreFieldGroup(['company_name', 'industry_category', 'detailed_address', 'offerings', 'trust_endorsements', 'target_keywords']) + buildRagScore(entries, indexStatus)) / 2),
      weight: 0.08,
      reason: '阶段二需要企业背景、关键词和可检索资料共同支撑。',
      missingItems: [],
      recommendedAction: '知识库达到 70 分以上后，可启动 AI 核心问题池构建。',
    }),
  ];

  const score = Math.round(dimensions.reduce((sum, dimension) => sum + dimension.score * dimension.weight, 0));
  const gaps = buildGapItems(profileData, dimensions);
  return {
    score,
    verdict: score >= 80
      ? '知识库已具备进入排行榜问题池构建的基础条件。'
      : score >= 60
        ? '知识库已可用，但建议先补齐高优先级缺口。'
        : '知识库仍偏薄，建议先完成企业资料与信任背书补充。',
    dimensions,
    gaps,
  };
}

function makeDimension(input: Omit<KnowledgeHealthDimension, 'status'>): KnowledgeHealthDimension {
  return {
    ...input,
    score: clampScore(input.score),
    status: scoreToStatus(input.score),
  };
}

function buildGapItems(
  profile: GeoAgentEnterpriseProfile,
  dimensions: KnowledgeHealthDimension[]
): KnowledgeGapItem[] {
  const priorityMap: Record<string, KnowledgeGapItem['priority']> = {
    公司名称: 'high',
    主营业务: 'high',
    企业详细介绍: 'high',
    '产品/服务介绍': 'high',
    用户痛点: 'high',
    信任背书: 'high',
    目标关键词: 'high',
    '行业/客户案例': 'medium',
    业务区域: 'medium',
    '品牌授权与客单价': 'medium',
    官方自媒体: 'medium',
    官方网站: 'medium',
    品牌故事: 'low',
    图片说明: 'low',
    其他信息补充: 'low',
  };
  const fromDimensions = dimensions.flatMap((dimension) => dimension.missingItems);
  const explicit = missingLabels(profile, [
    ['brand_story', '品牌故事'],
    ['image_notes', '图片说明'],
    ['extra_info', '其他信息补充'],
  ]);
  return Array.from(new Set([...fromDimensions, ...explicit])).map((label) => ({
    label,
    priority: priorityMap[label] ?? 'medium',
    actionPrompt: `请补充「${label}」，用于提升企业知识库健康度和 GEO 推荐可信度。`,
  })).sort((a, b) => priorityOrder(a.priority) - priorityOrder(b.priority));
}

function buildGeoStagesFromProject(
  geoProject: GeoAgentGeoProject | null,
  geoReports: Record<'doubao' | 'deepseek', GeoAgentGeoReport | null>,
  geoQuestionSets: Record<'doubao' | 'deepseek', GeoAgentGeoQuestionSet | null>,
  geoSourceDiscoveries: Record<'doubao' | 'deepseek', GeoAgentGeoSourceDiscovery | null>,
  geoArticleDrafts: Record<'doubao' | 'deepseek', { consulting: GeoAgentGeoArticleDraft | null; review: GeoAgentGeoArticleDraft | null }>
): GeoStageStatus[] {
  const doubaoStageTwoStatus = getPlatformStageTwoStatus(geoProject, 'doubao', geoReports.doubao, geoQuestionSets.doubao);
  const deepseekStageTwoStatus = getPlatformStageTwoStatus(geoProject, 'deepseek', geoReports.deepseek, geoQuestionSets.deepseek);
  const doubaoStageThreeStatus = getPlatformStageThreeStatus(geoProject, 'doubao', geoSourceDiscoveries.doubao, geoQuestionSets.doubao, geoReports.doubao);
  const deepseekStageThreeStatus = getPlatformStageThreeStatus(geoProject, 'deepseek', geoSourceDiscoveries.deepseek, geoQuestionSets.deepseek, geoReports.deepseek);
  const doubaoStageFourStatus = getPlatformStageFourStatus('doubao', geoSourceDiscoveries.doubao, geoArticleDrafts.doubao);
  const deepseekStageFourStatus = getPlatformStageFourStatus('deepseek', geoSourceDiscoveries.deepseek, geoArticleDrafts.deepseek);
  const stageOneStatus: GeoStageStatus['status'] = geoProject?.current_phase === 'ready_for_check'
    ? '可用'
    : geoProject?.current_phase === 'collecting'
      ? '进行中'
      : '待启动';
  const stageTwoStatuses = [doubaoStageTwoStatus.status, deepseekStageTwoStatus.status];
  const stageThreeStatuses = [doubaoStageThreeStatus.status, deepseekStageThreeStatus.status];
  const stageFourStatuses = [doubaoStageFourStatus.status, deepseekStageFourStatus.status];
  return [
    {
      label: '阶段一：企业知识库构建',
      status: stageOneStatus,
      description: stageOneStatus === '可用'
        ? '企业事实资料、知识条目和本地索引已具备排行榜问题池构建基础。'
        : '继续补齐企业资料、附件和索引状态。',
    },
    {
      label: '阶段二：AI 核心问题池',
      status: combineGeoStageStatuses(stageTwoStatuses),
      description: `基于企业知识库和目标词生成 10 条核心问题。${platformStatusSummary([
        ['豆包', doubaoStageTwoStatus],
        ['DeepSeek', deepseekStageTwoStatus],
      ])}`,
    },
    {
      label: '阶段三：高权重信源发现',
      status: combineGeoStageStatuses(stageThreeStatuses),
      description: `仅信源发现使用豆包助手联网能力，并只实测 3 条排行榜/推荐类问题。${platformStatusSummary([
        ['豆包', doubaoStageThreeStatus],
        ['DeepSeek', deepseekStageThreeStatus],
      ])}`,
    },
    {
      label: '阶段四：内容资产生成',
      status: combineGeoStageStatuses(stageFourStatuses),
      description: `生成咨询、测评和排行支撑稿件，供稿件管理与发布使用。${platformStatusSummary([
        ['豆包', doubaoStageFourStatus],
        ['DeepSeek', deepseekStageFourStatus],
      ])}`,
    },
    { label: '阶段五：稿件管理与发布', status: '待启动', description: '校对稿件、生成 OSS 预览、选择媒体投递并同步订单状态。' },
    { label: '阶段六：AI 推荐可见性检测', status: '待启动', description: '有已发布文章 URL 后自动检测核心问题，并每 10 分钟复查。' },
    { label: '阶段七：反思优化/自动学习', status: '待启动', description: '仅在文章被 AI 推荐或排名上升时生成待确认学习规则。' },
  ];
}

function buildGeoStagesFromWorkflow(workflow: GeoAgentWorkflowState | null): GeoStageStatus[] | null {
  if (!workflow) {
    return null;
  }
  return [
    {
      label: '阶段一：企业知识库构建',
      status: mapWorkflowStatus(workflow.stage_1.status),
      description: '上传或粘贴企业资料，确认后建立结构化知识库、本地全文索引和可选向量索引。',
    },
    {
      label: '阶段二：AI 核心问题池',
      status: workflowStageStatus(workflow, 'stage_2'),
      description: `基于企业知识库和目标词生成 10 条核心问题。${workflowPlatformSummary(workflow, 'stage_2')}`,
    },
    {
      label: '阶段三：高权重信源发现',
      status: workflowStageStatus(workflow, 'stage_3'),
      description: `仅信源发现使用豆包助手联网能力，并只实测 3 条排行榜/推荐类问题。${workflowPlatformSummary(workflow, 'stage_3')}`,
    },
    {
      label: '阶段四：内容资产生成',
      status: workflowStageStatus(workflow, 'stage_4'),
      description: `生成咨询、测评和排行支撑稿件，供稿件管理与发布使用。${workflowPlatformSummary(workflow, 'stage_4')}`,
    },
    {
      label: '阶段五：稿件管理与发布',
      status: workflowStageStatus(workflow, 'stage_5'),
      description: `校对稿件、生成 OSS 预览、选择媒体投递并同步订单状态。${workflowPlatformSummary(workflow, 'stage_5')}`,
    },
    {
      label: '阶段六：AI 推荐可见性检测',
      status: workflowStageStatus(workflow, 'stage_6'),
      description: `有已发布文章 URL 后使用 web search 可见性检测，并每 10 分钟复查。${workflowPlatformSummary(workflow, 'stage_6')}`,
    },
    {
      label: '阶段七：反思优化/自动学习',
      status: workflowStageStatus(workflow, 'stage_7'),
      description: `仅在文章被 AI 推荐或排名上升时生成待确认学习规则。${workflowPlatformSummary(workflow, 'stage_7')}`,
    },
  ];
}

function workflowStageStatus(workflow: GeoAgentWorkflowState, stageKey: string): GeoStageStatus['status'] {
  const statuses = Object.values(workflow.platforms)
    .map((platformState) => platformState.stages[stageKey]?.status)
    .filter((status): status is string => Boolean(status))
    .map(mapWorkflowStatus);
  return combineGeoStageStatuses(statuses);
}

function workflowPlatformSummary(workflow: GeoAgentWorkflowState, stageKey: string) {
  return platformStatusSummary(Object.values(workflow.platforms).map((platformState) => [
    platformState.label || platformState.platform,
    {
      status: mapWorkflowStatus(platformState.stages[stageKey]?.status || 'not_started'),
      description: platformState.stages[stageKey]?.description || '',
    },
  ]));
}

function platformStatusSummary(items: Array<[string, Pick<GeoStageStatus, 'status' | 'description'>]>) {
  const summary = items
    .map(([label, item]) => `${label}：${item.status}`)
    .join('；');
  return summary ? `平台状态：${summary}。` : '';
}

function combineGeoStageStatuses(statuses: GeoStageStatus['status'][]): GeoStageStatus['status'] {
  if (statuses.includes('进行中')) return '进行中';
  if (statuses.includes('可用')) return '可用';
  if (statuses.includes('待重试') || statuses.includes('已暂缓')) return '待重试';
  if (statuses.includes('待启动')) return '待启动';
  return '待开发';
}

function mapWorkflowStatus(status: string): GeoStageStatus['status'] {
  if (status === 'completed') return '可用';
  if (status === 'in_progress' || status === 'pending') return '进行中';
  if (status === 'ready' || status === 'not_started') return '待启动';
  if (status === 'user_deferred') return '待重试';
  if (status === 'failed') return '待重试';
  return '待启动';
}

function getPlatformStageFourStatus(
  platform: 'doubao' | 'deepseek',
  discovery: GeoAgentGeoSourceDiscovery | null,
  drafts: { consulting: GeoAgentGeoArticleDraft | null; review: GeoAgentGeoArticleDraft | null }
): Pick<GeoStageStatus, 'status' | 'description'> {
  const platformLabel = platform === 'doubao' ? '豆包' : 'DeepSeek';
  const consultingDone = drafts.consulting?.status === 'draft';
  const reviewDone = drafts.review?.status === 'draft';
  if (consultingDone && reviewDone) {
    return { status: '可用', description: `${platformLabel} 咨询类和测评类支撑文章已完成，可进入排行榜文章生成。` };
  }
  if (consultingDone || reviewDone) {
    return { status: '进行中', description: `${platformLabel} 已完成${consultingDone ? '咨询类' : '测评类'}支撑文章，继续补齐另一类。` };
  }
  if (discovery?.discovery.status === 'completed' || (discovery && discovery.discovery.status !== 'failed')) {
    return { status: '待启动', description: `${platformLabel} 信源发现已完成，可从智能助手生成咨询类和测评类支撑文章。` };
  }
  return { status: '待开发', description: `等待${platformLabel}高权重信源发现完成后再启动支撑内容生成。` };
}

function getPlatformStageThreeStatus(
  geoProject: GeoAgentGeoProject | null,
  platform: 'doubao' | 'deepseek',
  discovery: GeoAgentGeoSourceDiscovery | null,
  questionSet: GeoAgentGeoQuestionSet | null,
  report: GeoAgentGeoReport | null
): Pick<GeoStageStatus, 'status' | 'description'> {
  const platformLabel = platform === 'doubao' ? '豆包' : 'DeepSeek';
  if (discovery?.discovery.status === 'completed' || (discovery && discovery.discovery.status !== 'failed')) {
    return { status: '可用', description: `${platformLabel} 高权重信源发现已完成，可进入咨询类和测评类支撑内容生成。` };
  }
  if (discovery?.discovery.status === 'failed') {
    return { status: '待重试', description: `${platformLabel} 高权重信源发现失败，可从智能助手重新搜索信源。` };
  }
  const stageThree = (geoProject?.phase_status?.platforms?.[platform]?.stage_3 ?? {}) as { status?: string };
  if (stageThree.status === 'completed') {
    return { status: '可用', description: `${platformLabel} 高权重信源发现已完成，可进入咨询类和测评类支撑内容生成。` };
  }
  if (stageThree.status === 'ready' || questionSet || report?.status === 'completed') {
    return { status: '待启动', description: `${platformLabel} 排行榜问题池已完成，可从智能助手继续发现高权重信源。` };
  }
  return { status: '待开发', description: `等待${platformLabel}排行榜问题池完成后，再发现更容易被该平台引用的信源渠道。` };
}

function getPlatformStageTwoStatus(
  geoProject: GeoAgentGeoProject | null,
  platform: 'doubao' | 'deepseek',
  report: GeoAgentGeoReport | null,
  questionSet: GeoAgentGeoQuestionSet | null
): Pick<GeoStageStatus, 'status' | 'description'> {
  const platformLabel = platform === 'doubao' ? '豆包' : 'DeepSeek';
  if (questionSet || report?.status === 'completed') {
    return { status: '可用', description: `${platformLabel} 排行榜问题池已生成，可进入阶段三高权重信源发现。` };
  }
  if (report?.status === 'failed') {
    return { status: '待重试', description: `${platformLabel} 排行榜问题池生成失败：${report.error_message || '请重新生成问题池'}` };
  }
  const stageTwo = geoProject?.phase_status?.platforms?.[platform]?.stage_2 ?? {};
  if (stageTwo.status === 'pending') {
    return { status: '进行中', description: `已进入${platformLabel}阶段二准备，下一步生成${platformLabel}排行榜问题池。` };
  }
  if (stageTwo.status === 'user_deferred') {
    return { status: '待重试', description: `${platformLabel}阶段二可从智能助手重新生成问题池。` };
  }
  return { status: '待启动', description: `可从智能助手选择${platformLabel}模型启动排行榜问题池构建。` };
}

function formatCurrentPhase(phase?: string | null): string {
  if (phase === 'ready_for_check') {
    return 'ready_for_check / 可启动阶段二';
  }
  if (phase === 'collecting') {
    return 'collecting / 继续采集';
  }
  return 'pending / 阶段状态待刷新';
}

function buildProfileMarkdown(profile: GeoAgentEnterpriseProfile): string {
  const sections = profileSections.map((section) => [
    section.title,
    section.fields.map((field) => [field.label, profileFieldText(profile, field.key)] as [string, unknown]),
  ] as [string, Array<[string, unknown]>]);
  return [
    `# ${profileFieldText(profile, 'short_name') || profileFieldText(profile, 'company_name')}企业知识库`,
    '',
    ...sections.flatMap(([title, fields]) => [
      `## ${title}`,
      '',
      ...fields.map(([label, value]) => `### ${label}\n${hasText(value) ? String(value).trim() : '未填写'}\n`),
    ]),
  ].join('\n');
}

function missingLabels(profile: GeoAgentEnterpriseProfile, fields: Array<[keyof GeoAgentEnterpriseProfile, string]>) {
  return fields.filter(([field]) => !hasText(profileFieldText(profile, String(field)))).map(([, label]) => label);
}

function hasText(value: unknown) {
  return typeof value === 'string' ? value.trim().length > 0 : Boolean(value);
}

function keywordCount(value: unknown) {
  if (typeof value !== 'string') {
    return 0;
  }
  return value.split(/[\n,，;；、]+/).map((item) => item.trim()).filter(Boolean).length;
}

function buildRagScore(entries: GeoAgentKnowledgeEntry[], indexStatus: GeoAgentKnowledgeIndexStatus | null) {
  if (!entries.length) {
    return 0;
  }
  const indexed = indexStatus?.indexed ?? entries.filter((entry) => entry.embedding_status === 'indexed').length;
  const failed = indexStatus?.failed ?? entries.filter((entry) => entry.embedding_status === 'failed').length;
  const ratio = indexed / Math.max(entries.length, 1);
  return clampScore(Math.round(ratio * 90 + (entries.length >= 8 ? 10 : 0) - failed * 8));
}

function clampScore(score: number) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function scoreToStatus(score: number): KnowledgeHealthStatus {
  if (score >= 80) {
    return 'good';
  }
  if (score >= 55) {
    return 'warning';
  }
  if (score > 0) {
    return 'danger';
  }
  return 'muted';
}

function priorityOrder(priority: KnowledgeGapItem['priority']) {
  return priority === 'high' ? 0 : priority === 'medium' ? 1 : 2;
}

function statusClassName(status: KnowledgeHealthStatus) {
  if (status === 'good') {
    return 'bg-secondary/10 text-secondary';
  }
  if (status === 'warning') {
    return 'bg-amber-500/10 text-amber-700 dark:text-amber-300';
  }
  if (status === 'danger') {
    return 'bg-red-500/10 text-red-600 dark:text-red-300';
  }
  return 'bg-surface-container text-on-surface-variant';
}

function compactProfile(profile: ProfileFormState & { project_id: string }): GeoAgentEnterpriseProfileInput {
  return Object.entries(profile).reduce((acc, [key, value]) => {
    if (key === 'project_id') {
      return { ...acc, project_id: value };
    }
    const normalized = typeof value === 'string' ? value.trim() : value;
    if (!normalized && key !== 'company_name') {
      return acc;
    }
    const fieldValue = profileArrayFields.has(key as ProfileFieldKey)
      ? String(normalized || '').split(/[\n,，、;；|]+/).map((item) => item.trim()).filter(Boolean)
      : String(normalized || '').trim();
    return { ...acc, [key]: toProfileEvidenceField(fieldValue) };
  }, {} as GeoAgentEnterpriseProfileInput);
}

function profileToForm(profile: GeoAgentEnterpriseProfile): ProfileFormState {
  return Object.fromEntries(profileFieldDefinitions.map((field) => [
    field.key,
    profileFieldText(profile, field.key),
  ])) as ProfileFormState;
}

function buildImageNotes(images: UploadedImageAsset[]) {
  if (!images.length) {
    return '';
  }
  return images
    .map((image, index) => `${index + 1}. ${image.name}（${image.type || 'image'}，${formatFileSize(image.size)}）`)
    .join('\n');
}

function formatFileSize(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('文件读取失败。'));
    reader.onload = () => {
      const value = String(reader.result || '');
      resolve(value.includes(',') ? value.split(',', 2)[1] : value);
    };
    reader.readAsDataURL(file);
  });
}
