export {};

declare global {
  type GeoAgentSourceCitation = {
    title: string;
    url: string;
    logo_url?: string | null;
    start_index?: number | null;
    end_index?: number | null;
  };

  type GeoAgentSearchAction = {
    type?: string;
    query?: string;
    sources?: string[];
    max_keyword?: number;
    limit?: number;
    user_location?: Record<string, unknown>;
  };

  type GeoAgentSearchContext = {
    country?: string;
    region?: string;
    city?: string;
  };

  type GeoAgentSearchUsage = {
    tool_usage?: number;
    tool_usage_details?: Record<string, unknown>;
  };

  type GeoAgentKnowledgeEntry = {
    id: string;
    project_id?: string | null;
    parent_id?: string | null;
    title: string;
    content: string;
    source_type: string;
    metadata: Record<string, unknown>;
    chunk_index: number;
    embedding_status: 'pending' | 'indexed' | 'failed' | string;
    error_message?: string | null;
    created_at: string;
    updated_at: string;
  };

  type GeoAgentKnowledgeAsset = {
    id: string;
    project_id: string;
    filename: string;
    content_type?: string | null;
    file_path: string;
    source_type: string;
    status: 'pending' | 'processing' | 'indexed' | 'failed' | string;
    error_message?: string | null;
    created_at: string;
    updated_at: string;
  };

  type GeoAgentKnowledgeIndexStatus = {
    project_id?: string | null;
    embedding_model: string;
    vector_backend: string;
    embedding_backend: string;
    pending: number;
    indexed: number;
    failed: number;
    asset_count: number;
    assets: GeoAgentKnowledgeAsset[];
  };

  type GeoAgentKnowledgeEntriesResponse = {
    entries: GeoAgentKnowledgeEntry[];
    total: number;
  };

  type GeoAgentEnterpriseProfileInput = {
    id?: string | null;
    project_id?: string | null;
    company_name: string;
    short_name?: string | null;
    industry?: string | null;
    main_business?: string | null;
    official_website?: string | null;
    official_media?: string | null;
    detailed_intro?: string | null;
    brand_story?: string | null;
    products_services?: string | null;
    product_features?: string | null;
    user_pain_points?: string | null;
    trust_endorsements?: string | null;
    brand_authorization_pricing?: string | null;
    cases?: string | null;
    business_regions?: string | null;
    customer_service_phone?: string | null;
    current_pain_points?: string | null;
    core_advantages?: string | null;
    extra_info?: string | null;
    image_notes?: string | null;
    target_keywords?: string | null;
  };

  type GeoAgentEnterpriseProfile = GeoAgentEnterpriseProfileInput & {
    id: string;
    project_id?: string | null;
    company_name: string;
    generated_long_tail_keywords?: string | null;
    entry_count: number;
    created_at: string;
    updated_at: string;
  };

  type GeoAgentKnowledgeDraftAssetInput = {
    filename: string;
    content_type?: string | null;
    content_base64: string;
  };

  type GeoAgentKnowledgeDraftAsset = {
    id: string;
    draft_id: string;
    filename: string;
    content_type?: string | null;
    file_path: string;
    status: string;
    error_message?: string | null;
    created_at: string;
    updated_at: string;
  };

  type GeoAgentKnowledgeDraftFact = {
    id: string;
    field: string;
    label: string;
    value: string;
    source_file?: string | null;
    source_document_id?: string | null;
    quote?: string | null;
    confidence: number;
    extraction?: string;
  };

  type GeoAgentKnowledgeDraftFieldReview = {
    field: string;
    label: string;
    value: string;
    confirmed: boolean;
    confidence: number;
    source_fact_ids: string[];
    warning?: string | null;
  };

  type GeoAgentKnowledgeDraftSourceQuote = {
    id: string;
    source_file?: string | null;
    source_document_id?: string | null;
    quote: string;
    fields: string[];
  };

  type GeoAgentKnowledgeDraft = {
    id: string;
    intent: string;
    project_id?: string | null;
    conversation_id?: string | null;
    assistant_message_id?: string | null;
    status: string;
    profile: GeoAgentEnterpriseProfileInput;
    facts?: GeoAgentKnowledgeDraftFact[];
    field_reviews?: GeoAgentKnowledgeDraftFieldReview[];
    missing_fields: string[];
    confidence: Record<string, unknown>;
    source_summary: Record<string, unknown>;
    source_quotes?: GeoAgentKnowledgeDraftSourceQuote[];
    warnings?: string[];
    error_message?: string | null;
    extraction_status?: string;
    extraction_model?: string;
    assets: GeoAgentKnowledgeDraftAsset[];
    created_at: string;
    updated_at: string;
  };

  type GeoAgentKnowledgeDraftConfirmResponse = {
    ok: boolean;
    project_id: string;
    profile: GeoAgentEnterpriseProfile;
    entries: GeoAgentKnowledgeEntry[];
    total: number;
    index_status?: GeoAgentKnowledgeIndexStatus | null;
  };

  type GeoAgentSkill = {
    id: string;
    name: string;
    description: string;
    visibility?: 'user' | 'internal' | string;
    path: string;
    content: string;
  };

  type GeoAgentConversationSummary = {
    id: string;
    project_id?: string | null;
    kind?: string;
    title: string;
    summary?: string | null;
    summary_model?: string | null;
    summary_updated_at?: string | null;
    summary_message_count?: number;
    summary_dirty?: boolean;
    message_count: number;
    last_message?: string | null;
    last_message_preview?: string | null;
    created_at: string;
    updated_at: string;
  };

  type GeoAgentProjectSummary = {
    id: string;
    name: string;
    description?: string | null;
    company_name?: string | null;
    industry?: string | null;
    region?: string | null;
    status: string;
    created_at?: string;
    updated_at?: string;
  };

  type GeoAgentCreateProjectPayload = {
    name?: string;
    company_name?: string;
    companyName?: string;
    description?: string | null;
  };

  type GeoAgentGeoProject = {
    id: string;
    project_id: string;
    company_name: string;
    industry?: string | null;
    region?: string | null;
    current_phase: 'collecting' | 'ready_for_check' | string;
    platforms: string[];
    knowledge_base_ready: boolean;
    initial_keywords: string[];
    phase_status: {
      stage_1?: Record<string, unknown>;
      platforms?: Record<
        'doubao' | 'deepseek' | string,
        {
          stage_2?: {
            status?: 'not_started' | 'pending' | 'user_deferred' | 'completed' | string;
            label?: string;
            [key: string]: unknown;
          };
          [key: string]: unknown;
        }
      >;
      [key: string]: unknown;
    };
    created_at: string;
    updated_at: string;
  };

  type GeoAgentGeoReport = {
    id: string;
    geo_project_id: string;
    enterprise_project_id: string;
    platform: 'doubao' | 'deepseek' | string;
    status: 'completed' | 'failed' | string;
	    report: {
	      summary?: string;
	      question_pool?: unknown[];
	      ranking_questions?: unknown[];
	      [key: string]: unknown;
	    };
    markdown: string;
    error_message?: string | null;
    created_at: string;
    updated_at: string;
  };

  type GeoAgentGeoQuestionSet = {
    id: string;
    geo_project_id: string;
    enterprise_project_id: string;
    platform: 'doubao' | 'deepseek' | string;
	    questions: {
	      summary?: string;
	      question_pool?: unknown[];
	      ranking_questions?: unknown[];
	      [key: string]: unknown;
	    };
    created_at: string;
    updated_at: string;
  };

  type GeoAgentGeoSourceDiscovery = {
    id: string;
    geo_project_id: string;
    enterprise_project_id: string;
    project_id?: string;
    question_set_id?: string | null;
    platform: 'doubao' | 'deepseek' | string;
    status?: 'completed' | 'confirmed' | 'failed' | string;
    source_name?: string | null;
    source_url?: string | null;
    source_type?: string | null;
    content_format?: string | null;
    priority_score?: number;
    reason?: string | null;
    observed_in_answers?: string | null;
    recommended_topics?: string[];
    confirmed_at?: string | null;
    discovery: {
      summary?: string;
      status?: 'completed' | 'failed' | string;
	      ai_recommended_sources?: unknown[];
	      observed_citation_sources?: unknown[];
	      verified_observed_sources?: unknown[];
	      candidate_sources?: unknown[];
	      channel_priorities?: unknown[];
	      content_distribution_strategy?: Record<string, unknown>;
	      source_scores?: unknown[];
	      missing_evidence?: string[];
	      [key: string]: unknown;
	    };
    created_at: string;
    updated_at: string;
  };

  type GeoAgentGeoArticleDraft = {
    id: string;
    geo_project_id: string;
	    enterprise_project_id: string;
	    platform: 'doubao' | 'deepseek' | string;
	    article_type: 'consulting' | 'review' | 'ranking' | string;
	    status: 'draft' | 'confirmed' | 'failed' | string;
    draft: {
      title?: string;
      article_type?: string;
      target_question?: string;
      publish_target?: string;
      review_dimensions?: unknown[];
      outline?: unknown[];
      content?: string;
      facts_used?: unknown[];
      sources_to_reference?: unknown[];
      missing_facts?: string[];
      error_message?: string;
      [key: string]: unknown;
    };
    created_at: string;
    updated_at: string;
  };

  type GeoAgentGeoSupportArticleRunResponse = {
    geo_project_id: string;
    enterprise_project_id: string;
    platform: 'doubao' | 'deepseek' | string;
    status: 'completed' | 'partial_failed' | string;
    consulting_draft?: GeoAgentGeoArticleDraft | null;
    review_draft?: GeoAgentGeoArticleDraft | null;
	    error_message?: string | null;
	  };

	  type GeoAgentStageStatus = {
	    stage: number;
	    key: string;
	    label: string;
	    status: 'not_started' | 'ready' | 'pending' | 'in_progress' | 'completed' | 'user_deferred' | 'failed' | string;
	    description: string;
	    artifact_id?: string | null;
	    artifacts: Record<string, unknown>;
	  };

	  type GeoAgentPlatformWorkflowState = {
	    platform: 'doubao' | 'deepseek' | string;
	    label: string;
	    stages: Record<string, GeoAgentStageStatus>;
	  };

	  type GeoAgentWorkflowState = {
	    geo_project_id: string;
	    enterprise_project_id: string;
	    company_name: string;
	    current_phase: string;
	    knowledge_base_ready: boolean;
	    stage_1: GeoAgentStageStatus;
	    platforms: Record<string, GeoAgentPlatformWorkflowState>;
	  };

	  type GeoAgentConversationMessage = {
    id: string;
    conversation_id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    metadata?: Record<string, unknown>;
    created_at: string;
  };

  interface Window {
    geoAgent?: {
      // 窗口控制
      windowMinimize: () => Promise<void>;
      windowMaximize: () => Promise<void>;
      windowClose: () => Promise<void>;
      windowIsMaximized: () => Promise<boolean>;
      onWindowMaximizedChanged: (callback: (isMaximized: boolean) => void) => void;
      healthCheck: () => Promise<{ ok: boolean; service: string }>;
      getConfigStatus: () => Promise<{
        providers: Record<
          string,
          {
            provider: string;
            configured: boolean;
            model: string;
            base_url: string;
          }
        >;
      }>;
      sendChat: (
        message: string,
        conversationId?: string | null,
        options?: {
          projectId?: string;
          skillId?: string;
        }
      ) => Promise<{
        role: string;
        content: string;
        conversation_id: string;
        provider: string;
        model: string;
        error?: string | null;
        sources?: GeoAgentSourceCitation[];
        search_queries?: string[];
        search_actions?: GeoAgentSearchAction[];
        search_usage?: GeoAgentSearchUsage;
        reasoning_content?: string | null;
      }>;
      sendChatStream?: (
        message: string,
        conversationId: string | null | undefined,
        options: {
          projectId?: string;
          skillId?: string;
        },
        onEvent: (event: {
          type: 'meta' | 'status' | 'delta' | 'reasoning_delta' | 'search' | 'done' | 'error';
          text?: string;
          content?: string;
          message?: string;
          conversation_id?: string;
          provider?: string;
          model?: string;
          error?: string | null;
          sources?: GeoAgentSourceCitation[];
          search_queries?: string[];
          search_actions?: GeoAgentSearchAction[];
          search_usage?: GeoAgentSearchUsage;
          reasoning_content?: string | null;
          reasoning_delta?: string;
          search_status?: 'in_progress' | 'completed';
          search_query?: string;
          search_action?: GeoAgentSearchAction;
        }) => void
      ) => Promise<{
        type: 'done';
        conversation_id: string;
        provider: string;
        model: string;
        content?: string;
        error?: string | null;
        sources?: GeoAgentSourceCitation[];
        search_queries?: string[];
        search_actions?: GeoAgentSearchAction[];
        search_usage?: GeoAgentSearchUsage;
        reasoning_content?: string | null;
      }>;
      getProjects: () => Promise<{ projects: GeoAgentProjectSummary[] }>;
      createProject: (payload: GeoAgentCreateProjectPayload) => Promise<{ project: GeoAgentProjectSummary }>;
      getProject: (projectId: string) => Promise<{ project: GeoAgentProjectSummary }>;
      deleteProject: (projectId: string) => Promise<{ ok: boolean }>;
      ensureGeoProject: (projectId: string) => Promise<GeoAgentGeoProject>;
      getGeoProjects: (projectId?: string | null) => Promise<{ projects: GeoAgentGeoProject[] }>;
      getGeoProject: (geoProjectId: string) => Promise<GeoAgentGeoProject>;
      getGeoWorkflowState: (geoProjectId: string) => Promise<GeoAgentWorkflowState>;
      createGeoPhaseTwoPrompt: (
        geoProjectId: string,
        platform: 'doubao' | 'deepseek',
        conversationId?: string | null
      ) => Promise<{ conversation_id: string; message: GeoAgentConversationMessage }>;
      confirmGeoPhaseTwo: (geoProjectId: string, platform: 'doubao' | 'deepseek', messageId?: string | null) => Promise<GeoAgentGeoProject>;
      cancelGeoPhaseTwo: (geoProjectId: string, platform: 'doubao' | 'deepseek', messageId?: string | null) => Promise<GeoAgentGeoProject>;
      runGeoPhaseTwoReport: (geoProjectId: string, platform: 'doubao' | 'deepseek', messageId?: string | null) => Promise<GeoAgentGeoReport>;
      runGeoPhaseTwoReportStream?: (
        geoProjectId: string,
        platform: 'doubao' | 'deepseek',
        messageId: string | null | undefined,
        conversationId: string | null | undefined,
        onEvent: (event: {
          type: 'meta' | 'status' | 'summary_delta' | 'reasoning_delta' | 'result' | 'done' | 'error';
          step_index?: number;
          step_label?: string;
          message?: string;
          text?: string;
          content?: string;
          report?: GeoAgentGeoReport;
          question_set?: GeoAgentGeoQuestionSet;
          status?: string;
          error?: string;
        }) => void
      ) => Promise<{ type: 'done'; status?: string }>;
      getLatestGeoReport: (geoProjectId: string, platform: 'doubao' | 'deepseek') => Promise<GeoAgentGeoReport>;
      getGeoReport: (reportId: string) => Promise<GeoAgentGeoReport>;
      getLatestGeoQuestionSet: (geoProjectId: string, platform: 'doubao' | 'deepseek') => Promise<GeoAgentGeoQuestionSet>;
      getGeoQuestionSet: (questionSetId: string) => Promise<GeoAgentGeoQuestionSet>;
      runGeoSourceDiscovery: (
        geoProjectId: string,
        platform: 'doubao' | 'deepseek',
        fallbackReport?: GeoAgentGeoReport | null,
        messageId?: string | null
      ) => Promise<GeoAgentGeoSourceDiscovery>;
      runGeoSourceDiscoveryStream?: (
        geoProjectId: string,
        platform: 'doubao' | 'deepseek',
        fallbackReport: GeoAgentGeoReport | null | undefined,
        messageId: string | null | undefined,
        conversationId: string | null | undefined,
        parentMessageId: string | null | undefined,
        onEvent: (event: {
          type: 'meta' | 'status' | 'summary_delta' | 'result' | 'done' | 'error';
          step_index?: number;
          step_label?: string;
          conversation_id?: string;
          phase?: number;
          platform?: string;
          message?: GeoAgentConversationMessage | string;
          text?: string;
          content?: string;
          source_discovery?: GeoAgentGeoSourceDiscovery;
          status?: string;
          error?: string;
        }) => void
      ) => Promise<{ type: 'done'; status?: string }>;
      getLatestGeoSourceDiscovery: (geoProjectId: string, platform: 'doubao' | 'deepseek') => Promise<GeoAgentGeoSourceDiscovery>;
      getGeoSourceDiscovery: (discoveryId: string) => Promise<GeoAgentGeoSourceDiscovery>;
      getSourceDiscoveries: (
        projectId: string,
        platform?: 'doubao' | 'deepseek' | string | null
      ) => Promise<{ discoveries: GeoAgentGeoSourceDiscovery[] }>;
      confirmSourceDiscovery: (discoveryId: string) => Promise<GeoAgentGeoSourceDiscovery>;
      runGeoArticleDraft: (
        geoProjectId: string,
        platform: 'doubao' | 'deepseek',
        articleType: 'consulting' | 'review',
        options?: { topic?: string; targetQuestion?: string; messageId?: string | null }
      ) => Promise<GeoAgentGeoArticleDraft>;
      runGeoSupportArticles: (
        geoProjectId: string,
        platform: 'doubao' | 'deepseek',
        options?: { messageId?: string | null }
      ) => Promise<GeoAgentGeoSupportArticleRunResponse>;
      runGeoSupportArticlesStream?: (
        geoProjectId: string,
        platform: 'doubao' | 'deepseek',
        options: { messageId?: string | null; conversationId?: string | null; parentMessageId?: string | null } | undefined,
        onEvent: (event: {
          type: 'meta' | 'status' | 'summary_delta' | 'result' | 'done' | 'error';
          step_index?: number;
          step_label?: string;
          conversation_id?: string;
          phase?: number;
          platform?: string;
          message?: GeoAgentConversationMessage | string;
          text?: string;
          content?: string;
          support_articles?: GeoAgentGeoSupportArticleRunResponse;
          status?: string;
          error?: string;
        }) => void
      ) => Promise<{ type: 'done'; status?: string }>;
      getLatestGeoArticleDraft: (
        geoProjectId: string,
        platform: 'doubao' | 'deepseek',
        articleType: 'consulting' | 'review' | 'ranking'
      ) => Promise<GeoAgentGeoArticleDraft>;
      getGeoArticleDraft: (articleId: string) => Promise<GeoAgentGeoArticleDraft>;
      confirmGeoArticleDraft: (articleId: string, messageId?: string | null) => Promise<GeoAgentGeoArticleDraft>;
      updateGeoArticleDraft: (articleId: string, draft: Record<string, unknown>, messageId?: string | null) => Promise<GeoAgentGeoArticleDraft>;
      getConversations: (projectId?: string | null, limit?: number) => Promise<{
        conversations: GeoAgentConversationSummary[];
      }>;
      getPublicConversations: (limit?: number) => Promise<{
        conversations: GeoAgentConversationSummary[];
      }>;
      getConversation: (conversationId: string) => Promise<{
        conversation: GeoAgentConversationSummary;
        messages: GeoAgentConversationMessage[];
      }>;
      touchConversationSummary?: (
        conversationId: string,
        reason?: 'manual' | 'switch' | 'history_open' | 'new_conversation' | string
      ) => Promise<{ updated: boolean; conversation: GeoAgentConversationSummary | null }>;
      deleteConversation: (conversationId: string) => Promise<{ ok: boolean }>;
      clearConversationHistory: (payload: { projectId?: string | null; scope?: 'project' | 'all' }) => Promise<{ ok: boolean; scope?: string; project_id?: string }>;
      getKnowledgeEntries: (projectId?: string | null, limit?: number) => Promise<GeoAgentKnowledgeEntriesResponse>;
      createKnowledgeEntry: (entry: {
        content: string;
        title?: string | null;
        project_id?: string | null;
        source_type?: string;
      }) => Promise<GeoAgentKnowledgeEntriesResponse>;
      searchKnowledge: (query: string, projectId?: string | null, limit?: number) => Promise<GeoAgentKnowledgeEntriesResponse>;
      saveEnterpriseProfile: (profile: GeoAgentEnterpriseProfileInput) => Promise<GeoAgentKnowledgeEntriesResponse>;
      getKnowledgeProfiles: () => Promise<{ profiles: GeoAgentEnterpriseProfile[] }>;
      getKnowledgeProfile: (projectId: string) => Promise<{
        profile: GeoAgentEnterpriseProfile;
        entries: GeoAgentKnowledgeEntry[];
        total: number;
        index_status?: GeoAgentKnowledgeIndexStatus | null;
      }>;
      updateKnowledgeProfile: (projectId: string, profile: GeoAgentEnterpriseProfileInput) => Promise<GeoAgentKnowledgeEntriesResponse>;
      deleteKnowledgeProfile: (projectId: string) => Promise<{ ok: boolean }>;
      createKnowledgeAsset: (asset: {
        project_id: string;
        filename: string;
        content_type?: string | null;
        content_base64: string;
      }) => Promise<{
        asset: GeoAgentKnowledgeAsset;
        entries: GeoAgentKnowledgeEntry[];
        total: number;
      }>;
      createKnowledgeDraft: (draft: {
        message?: string | null;
        conversation_id?: string | null;
        intent?: string;
        project_id?: string | null;
        skill_id?: string | null;
        assets?: GeoAgentKnowledgeDraftAssetInput[];
      }) => Promise<GeoAgentKnowledgeDraft>;
      createKnowledgeDraftStream?: (
        draft: {
          message?: string | null;
          conversation_id?: string | null;
          intent?: string;
          project_id?: string | null;
          skill_id?: string | null;
          assets?: GeoAgentKnowledgeDraftAssetInput[];
        },
        onEvent: (event: {
          type:
            | 'meta'
            | 'status'
            | 'model_start'
            | 'model_status'
            | 'reasoning_delta'
            | 'delta'
            | 'draft_section'
            | 'result'
            | 'done'
            | 'error';
          task_type?: string;
          provider?: string;
          model?: string;
          api_family?: string;
          request_id?: string;
          http_status?: number;
          latency_ms?: number;
          section?: 'facts' | 'field_reviews' | 'source_quotes' | string;
          text?: string;
          items?: unknown[];
          message?: string;
          error?: string;
          draft?: GeoAgentKnowledgeDraft;
          can_proceed?: boolean;
          step_index?: number;
        }) => void
      ) => Promise<{
        type: 'done' | 'error';
        draft?: GeoAgentKnowledgeDraft;
        error?: string;
        can_proceed?: boolean;
      }>;
      confirmKnowledgeDraft: (
        draftId: string,
        profile?: GeoAgentEnterpriseProfileInput | null,
        conversationId?: string | null,
        draft?: GeoAgentKnowledgeDraft | null
      ) => Promise<GeoAgentKnowledgeDraftConfirmResponse>;
      rejectKnowledgeDraft: (draftId: string) => Promise<{ ok: boolean }>;
      reindexKnowledge: (projectId: string) => Promise<GeoAgentKnowledgeIndexStatus>;
      getKnowledgeIndexStatus: (projectId?: string | null) => Promise<GeoAgentKnowledgeIndexStatus>;
      getSkills: () => Promise<{ skills: GeoAgentSkill[] }>;
    };
  }
}
