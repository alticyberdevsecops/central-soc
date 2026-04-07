import Cookies from 'js-cookie';

/**
 * Dynamic API URL — derives the gateway address from the browser's current hostname.
 * This allows the app to work from localhost AND from any LAN IP without rebuild.
 *
 * Browser at http://localhost:8011     → API at http://localhost:8012
 * Browser at http://192.168.1.85:8011  → API at http://192.168.1.85:8012
 */
const API_URL = typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname}:8012`
    : (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8012');

export async function apiRequest(endpoint: string, options: RequestInit = {}) {
    const token = Cookies.get('soc_token');
    const headers: any = {
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...options.headers,
    };

    // Only set Content-Type if it's NOT a FormData (fetch handles boundary automatically)
    if (!(options.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
    }

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 30000); // 30s timeout

    try {
        const response = await fetch(`${API_URL}${endpoint}`, {
            ...options,
            headers,
            signal: controller.signal
        });
        clearTimeout(id);

        if (response.status === 401 && !endpoint.includes('/auth/login')) {
            Cookies.remove('soc_token');
            if (typeof window !== 'undefined') window.location.href = '/login';
            return;
        }

        if (!response.ok) {
            let errorMsg = 'API request failed';
            try {
                const error = await response.json();
                errorMsg = error.detail || errorMsg;
            } catch (e) {
                console.error("Failed to parse error response", e);
            }
            throw new Error(errorMsg);
        }

        if (response.status === 204) {
            return null;
        }

        return response.json();
    } catch (err: any) {
        clearTimeout(id);
        if (err.name === 'AbortError') {
            throw new Error('Request timed out after 30 seconds');
        }
        throw err;
    }
}

export const authApi = {
    login: (credentials: any) => apiRequest('/auth/login', { method: 'POST', body: JSON.stringify(credentials) }),
    me: () => apiRequest('/auth/me'),
    updateMe: (data: any) => apiRequest('/auth/me', { method: 'PATCH', body: JSON.stringify(data) }),
    // Signatures
    listSignatures: () => apiRequest('/auth/signatures'),
    createSignature: (data: any) => apiRequest('/auth/signatures', { method: 'POST', body: JSON.stringify(data) }),
    updateSignature: (id: string, data: any) => apiRequest(`/auth/signatures/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    deleteSignature: (id: string) => apiRequest(`/auth/signatures/${id}`, { method: 'DELETE' }),
};

export const incidentApi = {
    list: (params: any = {}) => {
        const query = new URLSearchParams(params).toString();
        return apiRequest(`/incidents?${query}`);
    },
    get: (id: string) => apiRequest(`/incidents/${id}`),
    update: (id: string, data: any) => apiRequest(`/incidents/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    updateStatus: (id: string, status: string) => apiRequest(`/incidents/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    stats: (params: any = {}) => {
        const query = new URLSearchParams(params).toString();
        return apiRequest(`/incidents/stats?${query}`);
    },
    addComment: (id: string, content: string) => apiRequest(`/incidents/${id}/comments`, { method: 'POST', body: JSON.stringify({ content }) }),
    setAgenticJob: (id: string, job_id: string) => apiRequest(`/incidents/${id}/agentic-job`, { method: 'PATCH', body: JSON.stringify({ job_id }) }),
    analyze: (id: string) => apiRequest(`/incidents/${id}/analyze`, { method: 'POST' }),
    getVerdict: (id: string) => apiRequest(`/incidents/${id}/verdict`),
    create: (data: any) => apiRequest('/incidents', { method: 'POST', body: JSON.stringify(data) }),
    delete: (id: string) => apiRequest(`/incidents/${id}`, { method: 'DELETE' }),
    sendEmail: (id: string, payload: string | FormData) => {
        if (typeof payload === 'string') {
            const fd = new FormData();
            fd.append('team_id', payload);
            return apiRequest(`/incidents/${id}/send-email`, { method: 'POST', body: fd });
        }
        return apiRequest(`/incidents/${id}/send-email`, { method: 'POST', body: payload });
    },
    getInteractions: (id: string) => apiRequest(`/incidents/${id}/interactions`),
    sendReply: (id: string, formData: FormData) => apiRequest(`/incidents/${id}/reply`, { method: 'POST', body: formData }),
    itsmComment: (id: string, formData: FormData) => apiRequest(`/incidents/${id}/itsm-comment`, { method: 'POST', body: formData }),
    downloadAttachment: async (incidentId: string, interactionId: string, filename: string) => {
        const token = Cookies.get('soc_token');
        const response = await fetch(`${API_URL}/incidents/${incidentId}/interactions/${interactionId}/attachments/${encodeURIComponent(filename)}`, {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });
        if (!response.ok) throw new Error('Failed to download attachment');
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
    },
};

export const tenantApi = {
    list: () => apiRequest('/tenants'),
    get: (id: string) => apiRequest(`/tenants/${id}`),
    delete: (id: string) => apiRequest(`/tenants/${id}`, { method: 'DELETE' }),
    listConnectors: (id: string) => apiRequest(`/tenants/${id}/connectors`),
    updateConnector: (tenantId: string, connectorId: string, params: any) =>
        apiRequest(`/tenants/${tenantId}/connectors/${connectorId}`, { method: 'PATCH', body: JSON.stringify(params) }),

    // Teams
    listTeams: (tenantId: string) => apiRequest(`/tenants/${tenantId}/teams`),
    createTeam: (tenantId: string, data: any) => apiRequest(`/tenants/${tenantId}/teams`, { method: 'POST', body: JSON.stringify(data) }),
    deleteTeam: (tenantId: string, teamId: string) => apiRequest(`/tenants/${tenantId}/teams/${teamId}`, { method: 'DELETE' }),

    // Levels
    listLevels: (teamId: string) => apiRequest(`/teams/${teamId}/levels`),
    createLevel: (teamId: string, data: any) => apiRequest(`/teams/${teamId}/levels`, { method: 'POST', body: JSON.stringify(data) }),
    updateLevel: (levelId: string, data: any) => apiRequest(`/levels/${levelId}`, { method: 'PATCH', body: JSON.stringify(data) }),
    deleteLevel: (levelId: string) => apiRequest(`/levels/${levelId}`, { method: 'DELETE' }),

    // Emails
    addEmail: (levelId: string, data: any) => apiRequest(`/levels/${levelId}/emails`, { method: 'POST', body: JSON.stringify(data) }),
    removeEmail: (levelId: string, emailId: string) => apiRequest(`/levels/${levelId}/emails/${emailId}`, { method: 'DELETE' }),

    // Mailing Configs (multi-server, per-tenant — used by regular users)
    listMailingConfigs: (tenantId: string) => apiRequest(`/tenants/${tenantId}/mailing-configs`),
    createMailingConfig: (tenantId: string, data: any) => apiRequest(`/tenants/${tenantId}/mailing-configs`, { method: 'POST', body: JSON.stringify(data) }),
    updateMailingConfig: (tenantId: string, configId: string, data: any) => apiRequest(`/tenants/${tenantId}/mailing-configs/${configId}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteMailingConfig: (tenantId: string, configId: string) => apiRequest(`/tenants/${tenantId}/mailing-configs/${configId}`, { method: 'DELETE' }),
    // Legacy single
    getMailingConfig: (tenantId: string) => apiRequest(`/tenants/${tenantId}/mailing-config`),
    testSmtp: (data: any) => apiRequest('/tenants/test-smtp', { method: 'POST', body: JSON.stringify(data) }),
    // Group-based (multi-tenant) — used by super_admin
    listAllMailingConfigsGrouped: () => apiRequest('/mailing-configs'),
    createMailingConfigGroup: (data: any) => apiRequest('/mailing-configs', { method: 'POST', body: JSON.stringify(data) }),
    updateMailingConfigGroup: (groupId: string, data: any) => apiRequest(`/mailing-configs/group/${groupId}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteMailingConfigGroup: (groupId: string) => apiRequest(`/mailing-configs/group/${groupId}`, { method: 'DELETE' }),
};

export const slaApi = {
    // Tenant SLA config
    getConfig: (tenantId: string) => apiRequest(`/tenants/${tenantId}/sla-config`),
    saveConfig: (tenantId: string, data: any) => apiRequest(`/tenants/${tenantId}/sla-config`, { method: 'PUT', body: JSON.stringify(data) }),
    patchConfig: (tenantId: string, data: any) => apiRequest(`/tenants/${tenantId}/sla-config`, { method: 'PATCH', body: JSON.stringify(data) }),
    // Incident SLA
    getSummary: (params: any = {}) => {
        const query = new URLSearchParams(params).toString();
        return apiRequest(`/incidents/sla/summary?${query}`);
    },
    getAnalysts: (params: any = {}) => {
        const query = new URLSearchParams(params).toString();
        return apiRequest(`/incidents/sla/analysts?${query}`);
    },
    getAnalyst: (analystId: string, params: any = {}) => {
        const query = new URLSearchParams(params).toString();
        return apiRequest(`/incidents/sla/analysts/${analystId}?${query}`);
    },
    getIncidentSla: (incidentId: string) => apiRequest(`/incidents/${incidentId}/sla`),
    getTimeSeries: (params: any = {}) => {
        const query = new URLSearchParams(params).toString();
        return apiRequest(`/incidents/sla/time-series?${query}`);
    },
    getCisoDashboard: () => apiRequest('/incidents/ciso/dashboard'),
};

export const automationApi = {
    // Workflows
    listWorkflows: (params: any = {}) => {
        const query = new URLSearchParams(params).toString();
        return apiRequest(`/automations/workflows?${query}`);
    },
    getWorkflow: (id: string) => apiRequest(`/automations/workflows/${id}`),
    createWorkflow: (data: any) => apiRequest('/automations/workflows', { method: 'POST', body: JSON.stringify(data) }),
    updateWorkflow: (id: string, data: any) => apiRequest(`/automations/workflows/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteWorkflow: (id: string) => apiRequest(`/automations/workflows/${id}`, { method: 'DELETE' }),
    publishWorkflow: (id: string) => apiRequest(`/automations/workflows/${id}/publish`, { method: 'POST' }),
    pauseWorkflow: (id: string) => apiRequest(`/automations/workflows/${id}/pause`, { method: 'POST' }),
    cloneWorkflow: (id: string) => apiRequest(`/automations/workflows/${id}/clone`, { method: 'POST' }),
    executeWorkflow: (id: string, data: any = {}) => apiRequest(`/automations/workflows/${id}/execute`, { method: 'POST', body: JSON.stringify(data) }),

    // Executions
    listExecutions: (params: any = {}) => {
        const query = new URLSearchParams(params).toString();
        return apiRequest(`/automations/executions?${query}`);
    },
    getExecution: (id: string) => apiRequest(`/automations/executions/${id}`),

    // Templates
    listTemplates: (params: any = {}) => {
        const query = new URLSearchParams(params).toString();
        return apiRequest(`/automations/templates?${query}`);
    },
    getTemplate: (id: string) => apiRequest(`/automations/templates/${id}`),
    useTemplate: (id: string) => apiRequest(`/automations/templates/${id}/use`, { method: 'POST' }),

    // Node catalog
    getNodeCatalog: () => apiRequest('/automations/node-catalog'),

    // Credentials
    listCredentials: (params: any = {}) => {
        const query = new URLSearchParams(params).toString();
        return apiRequest(`/automations/credentials?${query}`);
    },
    createCredential: (data: any) => apiRequest('/automations/credentials', { method: 'POST', body: JSON.stringify(data) }),
    updateCredential: (id: string, data: any) => apiRequest(`/automations/credentials/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteCredential: (id: string) => apiRequest(`/automations/credentials/${id}`, { method: 'DELETE' }),

    // Approvals
    listApprovals: (params: any = {}) => {
        const query = new URLSearchParams(params).toString();
        return apiRequest(`/automations/approvals?${query}`);
    },
    getApproval: (id: string) => apiRequest(`/automations/approvals/${id}`),
    decideApproval: (id: string, data: any) => apiRequest(`/automations/approvals/${id}/decide`, { method: 'POST', body: JSON.stringify(data) }),

    // Webhooks
    createWebhook: (workflowId: string) => apiRequest(`/automations/workflows/${workflowId}/webhooks`, { method: 'POST' }),
    listWebhooks: (workflowId: string) => apiRequest(`/automations/workflows/${workflowId}/webhooks`),
    deleteWebhook: (id: string) => apiRequest(`/automations/webhooks/${id}`, { method: 'DELETE' }),

    // Schedules
    createSchedule: (workflowId: string, data: any) => apiRequest(`/automations/workflows/${workflowId}/schedules`, { method: 'POST', body: JSON.stringify(data) }),
    listSchedules: (workflowId: string) => apiRequest(`/automations/workflows/${workflowId}/schedules`),
    deleteSchedule: (id: string) => apiRequest(`/automations/schedules/${id}`, { method: 'DELETE' }),

    // Resume
    resumeExecution: (id: string) => apiRequest(`/automations/executions/${id}/resume`, { method: 'POST' }),
};

export const userApi = {
    list: (params: any = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') query.set(k, String(v)); });
        return apiRequest(`/auth/users?${query.toString()}`);
    },
    create: (data: any) => apiRequest('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => apiRequest(`/auth/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    toggleStatus: (id: string) => apiRequest(`/auth/users/${id}/toggle-status`, { method: 'PATCH' }),
    delete: (id: string) => apiRequest(`/auth/users/${id}`, { method: 'DELETE' }),
    resetPassword: (id: string, password: string) => apiRequest(`/auth/users/${id}/reset-password`, { method: 'PATCH', body: JSON.stringify({ password }) }),
};

export const integrationApi = {
    listConfigs: (tenantId: string) =>
        apiRequest(`/tenants/${tenantId}/integrations`),
    upsertConfig: (tenantId: string, integration: string, data: any) =>
        apiRequest(`/tenants/${tenantId}/integrations/${integration}`, {
            method: 'PUT', body: JSON.stringify(data),
        }),
    patchConfig: (tenantId: string, integration: string, data: any) =>
        apiRequest(`/tenants/${tenantId}/integrations/${integration}`, {
            method: 'PATCH', body: JSON.stringify(data),
        }),
    deleteConfig: (tenantId: string, integration: string) =>
        apiRequest(`/tenants/${tenantId}/integrations/${integration}`, { method: 'DELETE' }),
    bulkToggle: (data: { tenant_ids: string[]; integration: string; is_enabled: boolean; config?: any }) =>
        apiRequest('/tenants/integrations/bulk-toggle', {
            method: 'POST', body: JSON.stringify(data),
        }),
};

export const xsiamApi = {
    getPosture: (tenantId: string, timeframe: string = "15d") => apiRequest(`/tenants/${tenantId}/xsiam/posture?timeframe=${timeframe}`),
    getVulnerabilities: (tenantId: string, timeframe: string = "15d") => apiRequest(`/tenants/${tenantId}/xsiam/vulnerabilities?timeframe=${timeframe}`),
    getIncidents: (tenantId: string, timeframe: string = "15d") => apiRequest(`/tenants/${tenantId}/xsiam/incidents?timeframe=${timeframe}`),
    getIncidentDetail: (tenantId: string, incidentId: string) => apiRequest(`/tenants/${tenantId}/xsiam/incidents/${incidentId}`),
    getMitre: (tenantId: string, timeframe: string = "15d") => apiRequest(`/tenants/${tenantId}/xsiam/mitre?timeframe=${timeframe}`),
    getSocPerformance: (tenantId: string, timeframe: string = "30d") => apiRequest(`/tenants/${tenantId}/xsiam/soc-performance?timeframe=${timeframe}`),
    getRiskyUsers: (tenantId: string, timeframe: string = "15d") => apiRequest(`/tenants/${tenantId}/xsiam/risky-users?timeframe=${timeframe}`),
    getAttackSurface: (tenantId: string, timeframe: string = "15d") => apiRequest(`/tenants/${tenantId}/xsiam/attack-surface?timeframe=${timeframe}`),
    getThreatIntel: (tenantId: string, timeframe: string = "15d") => apiRequest(`/tenants/${tenantId}/xsiam/threat-intel?timeframe=${timeframe}`),
    getQueryTemplates: (tenantId: string) => apiRequest(`/tenants/${tenantId}/xsiam/query-templates`),
    runQuery: (tenantId: string, query: string, timeframe: string = "15d") => 
        apiRequest(`/tenants/${tenantId}/xsiam/run-query`, { method: 'POST', body: JSON.stringify({ query, timeframe }) }),
    getIntel: (tenantId: string, timeframe: string = "15d") => apiRequest(`/tenants/${tenantId}/xsiam/intel?timeframe=${timeframe}`),
    getCompliance: (tenantId: string, timeframe: string = "15d") => apiRequest(`/tenants/${tenantId}/xsiam/compliance?timeframe=${timeframe}`),
    getBenchmarks: (tenantId: string, timeframe: string = "15d") => apiRequest(`/tenants/${tenantId}/xsiam/benchmarks?timeframe=${timeframe}`),
    getCrownJewels: (tenantId: string, timeframe: string = "15d") => apiRequest(`/tenants/${tenantId}/xsiam/crown-jewels?timeframe=${timeframe}`),
    getThreatTrends: (tenantId: string, timeframe: string = "15d") => apiRequest(`/tenants/${tenantId}/xsiam/threat-trends?timeframe=${timeframe}`),
    getDataExfiltration: (tenantId: string, timeframe: string = "15d") => apiRequest(`/tenants/${tenantId}/xsiam/data-exfiltration?timeframe=${timeframe}`),
    getAlertVolume: (tenantId: string, timeframe: string = "15d") => apiRequest(`/tenants/${tenantId}/xsiam/alert-volume?timeframe=${timeframe}`),
    getNoticePeriodUsers: (tenantId: string, timeframe: string = "15d") => apiRequest(`/tenants/${tenantId}/xsiam/notice-period-users?timeframe=${timeframe}`),
};
