-- Budget & Resources Tracking Module
-- Module: budget_resources
-- Description: Budget baseline, actuals, headcount planning, AI usage tracking

-- Budget Plan Table
CREATE TABLE budget_plan (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    category TEXT NOT NULL, -- 'personnel', 'ai_cloud_services', 'tooling', 'contractors', 'contingency'
    line_item_name TEXT NOT NULL,
    planned_amount DECIMAL(12,2) NOT NULL,
    allocated_fte DECIMAL(5,2) DEFAULT 0, -- percentage (0-100)
    currency TEXT DEFAULT 'USD',
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by TEXT,
    FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- Budget Actuals Table
CREATE TABLE budget_actuals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    budget_plan_id INTEGER,
    category TEXT NOT NULL,
    line_item_name TEXT NOT NULL,
    actual_amount DECIMAL(12,2) NOT NULL,
    actual_date DATE NOT NULL,
    data_source TEXT, -- 'erp', 'expense_tool', 'manual_entry', 'api_integration'
    source_reference TEXT, -- e.g., invoice_id, expense_entry_id
    audit_trail_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT,
    FOREIGN KEY (project_id) REFERENCES projects(id),
    FOREIGN KEY (budget_plan_id) REFERENCES budget_plan(id),
    FOREIGN KEY (audit_trail_id) REFERENCES activity_log(id)
);

-- Headcount Plan Table
CREATE TABLE headcount_plan (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    role_name TEXT NOT NULL,
    planned_fte DECIMAL(5,2) NOT NULL, -- number of FTEs
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    planned_rate_per_fte DECIMAL(12,2) NOT NULL, -- loaded cost rate
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by TEXT,
    FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- Headcount Assignment (Actuals)
CREATE TABLE headcount_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    headcount_plan_id INTEGER,
    person_id INTEGER,
    assigned_fte DECIMAL(5,2) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NULL,
    confirmed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    confirmed_by TEXT,
    FOREIGN KEY (project_id) REFERENCES projects(id),
    FOREIGN KEY (headcount_plan_id) REFERENCES headcount_plan(id)
);

-- AI Usage Tracking
CREATE TABLE ai_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    team_id INTEGER,
    api_provider TEXT NOT NULL, -- 'openai', 'anthropic', 'azure_openai', 'aws_bedrock', 'gcp_vertex'
    model TEXT NOT NULL,
    request_type TEXT NOT NULL, -- 'chat_completion', 'embedding', 'finetuning', 'other'
    prompt_tokens INTEGER NOT NULL,
    completion_tokens INTEGER NOT NULL,
    total_tokens INTEGER NOT NULL,
    cost_per_1k_prompt DECIMAL(12,4),
    cost_per_1k_completion DECIMAL(12,4),
    total_cost DECIMAL(12,4) NOT NULL,
    completion_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    model_efficiency_score INTEGER, -- 0-100 based on cost-per-task metric
    FOREIGN KEY (project_id) REFERENCES projects(id),
    FOREIGN KEY (team_id) REFERENCES teams(id)
);

-- AI Quota Limits
CREATE TABLE ai_quota_limits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    provider TEXT NOT NULL,
    monthly_spend_cap DECIMAL(12,2),
    monthly_token_limit INTEGER,
    daily_spend_limit DECIMAL(12,2),
    daily_token_limit INTEGER,
    email_alert_threshold DECIMAL(5,2) DEFAULT 0.70,
    slack_alert_threshold DECIMAL(5,2) DEFAULT 0.90,
    version INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- Resource Demand Forecast
CREATE TABLE resource_demand_forecast (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    role_type TEXT NOT NULL, -- 'senior_engineer', 'junior_engineer', 'ux_designer', 'pm', 'qa'
    forecast_week INTEGER NOT NULL,
    demand_fte DECIMAL(5,2) NOT NULL,
    horizon_week INTEGER NOT NULL, -- 2, 4, or 8
    source TEXT, -- 'schedule_based', 'task_analysis'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- Audit Trail for Budget Changes
CREATE TABLE budget_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    resource_type TEXT NOT NULL, -- 'budget', 'headcount', 'ai_usage'
    action TEXT NOT NULL, -- 'created', 'updated', 'forecasted', 'alert_trigger'
    field_name TEXT,
    old_value TEXT,
    new_value TEXT,
    reason TEXT,
    related_record_id INTEGER,
    actor_ref TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- Indexes for performance
CREATE INDEX idx_budget_plan_project ON budget_plan(project_id);
CREATE INDEX idx_budget_actuals_project ON budget_actuals(project_id);
CREATE INDEX idx_budget_actuals_date ON budget_actuals(actual_date);
CREATE INDEX idx_headcount_plan_project ON headcount_plan(project_id);
CREATE INDEX idx_headcount_assignments_project ON headcount_assignments(project_id);
CREATE INDEX idx_ai_usage_project ON ai_usage(project_id);
CREATE INDEX idx_ai_usage_provider_date ON ai_usage(api_provider, completion_date);
CREATE INDEX idx_ai_quota_limits_project ON ai_quota_limits(project_id);
CREATE INDEX idx_resource_demand_project ON resource_demand_forecast(project_id);
CREATE INDEX idx_budget_audit_project ON budget_audit(project_id);