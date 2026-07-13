import { Router } from 'express';
const router = Router();

/**
 * GET /api/budget/resources/dashboard
 * Retrieves executive dashboard with budget, headcount, and AI resources
 */
router.get('/dashboard', async (req, res) => {
  try {
    const db = req.app.get('db');
    const projectId = req.query.projectId;

    if (!projectId) {
      return res.status(400).json({ error: 'projectId is required' });
    }

    // Fetch budget data
    const budgetQuery = `
      SELECT
        SUM(planned_amount) as total_budget,
        SUM(actual_amount) as total_actual,
        SUM(planned_amount) * 1.05 as eac_forecast, -- EAC with 5% buffer
        AVG(budget_variance_percent) as budget_variance_percent
      FROM (
        SELECT
          b.id,
          (SELECT COALESCE(SUM(actual_amount), 0) FROM budget_actuals ba WHERE ba.budget_plan_id = b.id) as actual_amount,
          (SELECT (COALESCE(SUM(actual_amount), 0) - planned_amount) FROM budget_actuals ba WHERE ba.budget_plan_id = b.id) as budget_variance,
          (COALESCE(SUM(actual_amount), 0) / planned_amount) * 100 as budget_variance_percent
        FROM budget_plan b
        WHERE b.project_id = ?
      )
    `;

    const budgetResult: any[] = await db.all(budgetQuery, [projectId]);

    // Fetch headcount data
    const headcountQuery = `
      SELECT
        hd.role_name,
        SUM(hp.planned_fte) as total_plan_fte,
        SUM(ha.assigned_fte) as total_actual_fte
      FROM headcount_plan hp
      LEFT JOIN headcount_assignments ha ON hp.id = ha.headcount_plan_id AND ha.end_date IS NULL
      LEFT JOIN headcount_domains hd ON hp.domain_id = hd.id
      WHERE hp.project_id = ?
      GROUP BY hp.role_name
    `;

    const headcountResult: any[] = await db.all(headcountQuery, [projectId]);

    // Fetch AI data
    const aiQuery = `
      SELECT
        SUM(total_cost) as total_cost_month
      FROM ai_usage
      WHERE project_id = ? AND datetime(completion_date) >= datetime('now', '-1 month')
    `;

    const aiResult: any[] = await db.all(aiQuery, [projectId]);

    // Fetch AI quota limits
    const quotaQuery = `
      SELECT
        provider,
        monthly_spend_cap,
        daily_spend_limit,
        daily_token_limit
      FROM ai_quota_limits
      WHERE project_id = ?
    `;

    const quotaResult: any[] = await db.all(quotaQuery, [projectId]);

    // Build categories
    const categoriesQuery = `
      SELECT
        b.category,
        b.line_item_name,
        b.planned_amount,
        COALESCE(SUM(ba.actual_amount), 0) as actual_amount,
        (COALESCE(SUM(ba.actual_amount), 0) - b.planned_amount) as budget_variance,
        (COALESCE(SUM(ba.actual_amount), 0) / b.planned_amount) * 100 as percent_consumed
      FROM budget_plan b
      WHERE b.project_id = ?
      GROUP BY b.id
    `;

    const categoriesResult: any[] = await db.all(categoriesQuery, [projectId]);

    // Calculate RAG status
    const totalBudget = budgetResult[0]?.total_budget || 0;
    const totalActual = budgetResult[0]?.total_actual || 0;
    const budgetVariance = budgetResult[0]?.budget_variance || 0;
    const budgetVariancePercent = budgetResult[0]?.budget_variance_percent || 0;
    const ragStatus =
      budgetVariancePercent > 15 ? 'red' :
      budgetVariancePercent > 10 ? 'amber' : 'green';

    // Build headcount roles
    const headcountRoles: any[] = headcountResult.map((row: any) => ({
      id: Math.random().toString(36).substr(2, 9),
      role_name: row.role_name || 'General',
      planned_fte: parseFloat(row.total_plan_fte || 0),
      actual_fte: parseFloat(row.total_actual_fte || 0),
      allocation_percent: ((row.total_actual_fte || 0) / (row.total_plan_fte || 1)) * 100,
      status:
        (row.total_actual_fte || 0) === 0 ? 'unfilled' :
        ((row.total_actual_fte || 0) / (row.total_plan_fte || 1) > 1.5) ? 'over_allocated' :
        ((row.total_actual_fte || 0) / (row.total_plan_fte || 1) < 0.5) ? 'under_allocated' : 'optimal'
    }));

    const headcountStatus =
      headcountRoles.filter((r) => r.status === 'unfilled').length > 0 ? 'amber' :
      headcountRoles.filter((r) => r.status === 'under_allocated').length > 0 ? 'red' : 'green';

    // Build AI providers
    const aiProviders = quotaResult.map((quota: any) => ({
      id: Math.random().toString(36).substr(2, 9),
      provider: quota.provider,
      model: quota.provider, // Simplified for demo
      monthly_cost: parseFloat(aiResult[0]?.total_cost_month || 0),
      daily_cost: (parseFloat(aiResult[0]?.total_cost_month || 0) / 30),
      token_usage: quota.daily_token_limit || 1000000,
      daily_rate_limit: quota.daily_token_limit || 1000000,
      daily_rate_consumed: parseFloat(quota.daily_token_limit || 1000000) * 0.85,
      limit_remaining: true,
      warning_level: parseFloat(quota.daily_token_limit || 1000000) * 0.85 >= quota.daily_token_limit * 0.7
    }));

    const aiStatus =
      aiProviders.some((p) => p.warning_level) ? 'amber' :
      aiProviders.some((p) => !p.limit_remaining) ? 'red' : 'green';

    // Get runway (days until end of current planned period)
    const runwayQuery = `
      SELECT MIN(e.end_date) as runway_date
      FROM headcount_plan hp
      JOIN headcount_domains hd ON hp.domain_id = hd.id
      JOIN headcount_assignments ha ON hp.id = ha.headcount_plan_id
      WHERE hp.project_id = ?
      AND ha.end_date IS NULL
    `;

    const runwayResult: any[] = await db.all(runwayQuery, [projectId]);
    const runway = runwayResult[0]?.runway_date || 'TBD';

    // Build risk list
    const risks: any[] = [];

    if (budgetVariancePercent >= 10) {
      risks.push({
        id: 1,
        title: 'Budget Overrun Risk',
        severity: 'medium',
        type: 'budget',
        description: `Budget variance of ${budgetVariancePercent.toFixed(2)}% exceeds the ${budgetVariancePercent >= 15 ? '15% critical' : '10% warning'} threshold. Consider reforecast or contingency utilization.`
      });
    } else if (budgetVariancePercent >= 5) {
      risks.push({
        id: 1,
        title: 'Budget Near Tolerance',
        severity: 'low',
        type: 'budget',
        description: `Budget variance of ${budgetVariancePercent.toFixed(2)}% approaching tolerance thresholds. Monitor daily actuals and adjust forecasts if needed.`
      });
    }

    if (headcountRoles.some((r) => r.status === 'under_allocated' || r.status === 'unfilled')) {
      risks.push({
        id: 2,
        title: 'Resource Shortage Detected',
        severity: 'high',
        type: 'headcount',
        description: `${headcountRoles.filter((r) => r.status === 'under_allocated').length} roles under-allocated. Address staffing needs to avoid schedule delays.`
      });
    }

    if (aiProviders.some((p) => p.warning_level)) {
      risks.push({
        id: 3,
        title: 'AI Quota Near Limit',
        severity: 'medium',
        type: 'ai',
        description: `${aiProviders.filter((p) => p.warning_level).length} AI providers approaching spend or token limits. Configure alerts and consider quota adjustments.`
      });
    }

    res.json({
      success: true,
      data: {
        budget: {
          total_budget: parseFloat(totalBudget.toFixed(2)),
          total_actual: parseFloat(totalActual.toFixed(2)),
          eac_forecast: parseFloat(budgetResult[0]?.eac_forecast || totalBudget),
          budget_variance_float: budgetVariance,
          budget_variance_percent: parseFloat(budgetVariancePercent.toFixed(2)),
          burn_rate_2_week: parseFloat((totalActual / 14).toFixed(2)),
          runway_doi: runway,
          rag_status: ragStatus,
          categories: categoriesResult.map((cat: any) => ({
            id: cat.id,
            category: cat.category,
            line_item_name: cat.line_item_name,
            planned_amount: parseFloat(cat.planned_amount),
            actual_amount: parseFloat(cat.actual_amount),
            variance: parseFloat(cat.budget_variance),
            percent_consumed: parseFloat(cat.percent_consumed.toFixed(2))
          }))
        },
        headcount: {
          total_plan_fte: headcountRoles.reduce((sum, r) => sum + r.planned_fte, 0),
          total_actual_fte: headcountRoles.reduce((sum, r) => sum + r.actual_fte, 0),
          allocation_gap: headcountRoles.reduce((sum, r) => sum + (r.planned_fte - r.actual_fte), 0),
          roles: headcountRoles,
          rag_status: headcountStatus
        },
        ai: {
          total_cost_month: parseFloat(aiResult[0]?.total_cost_month || 0),
          total_cost_last_7_days: parseFloat(((aiResult[0]?.total_cost_month || 0) / 30 * 7).toFixed(2)),
          providers: aiProviders,
          rag_status: aiStatus
        },
        top_risks: risks
      }
    });
  } catch (error) {
    console.error('Error fetching budget resources dashboard:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

/**
 * POST /api/budget/resources/baseline/ingest
 * Ingest a budget baseline (CSV, spreadsheet, or API)
 */
router.post('/baseline/ingest', async (req, res) => {
  try {
    const { projectId, budgetData, dataSource } = req.body;

    if (!projectId || !budgetData) {
      return res.status(400).json({ error: 'projectId and budgetData are required' });
    }

    const db = req.app.get('db');
    const transaction = db.transaction();

    // Clear existing budget plan for this project (in a real app, this would be versioned)
    transaction.run(`
      DELETE FROM budget_plan WHERE project_id = ?
    `, [projectId]);

    // Insert budget plan items
    for (const item of budgetData) {
      transaction.run(`
        INSERT INTO budget_plan (
          project_id,
          category,
          line_item_name,
          planned_amount,
          allocated_fte,
          start_date,
          end_date,
          created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [projectId, item.category, item.line_itemName, item.plannedAmount, item.allocatedFte || 0, item.startDate, item.endDate, req.user?.id || 'system']);
    }

    transaction.run();
    res.json({ success: true, message: 'Budget baseline ingested successfully' });
  } catch (error) {
    console.error('Error ingesting budget baseline:', error);
    res.status(500).json({ error: 'Failed to ingest budget baseline' });
  }
});

/**
 * GET /api/budget/resources/actuals/:projectId
 * Get budget actuals for a project
 */
router.get('/actuals/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const db = req.app.get('db');

    const actualsQuery = `
      SELECT
        id,
        category,
        line_item_name,
        actual_amount,
        actual_date,
        data_source,
        source_reference
      FROM budget_actuals
      WHERE project_id = ?
      ORDER BY actual_date DESC
    `;

    const actuals = await db.all(actualsQuery, [projectId]);

    res.json({
      success: true,
      data: actuals
    });
  } catch (error) {
    console.error('Error fetching budget actuals:', error);
    res.status(500).json({ error: 'Failed to fetch budget actuals' });
  }
});

export default router;