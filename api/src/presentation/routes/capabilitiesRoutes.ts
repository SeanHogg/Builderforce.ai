import { Router } from 'express';
import { db } from '../../db';
import { CapabilityNode, CapabilityRelation, CapabilityRollup, ExportOptions } from '../../application/types';

const router = Router();

// GET /api/capabilities?projectId=123
router.get('/capabilities', async (req, res) => {
  try {
    const { projectId } = req.query;
    // Fetch capabilities for the project (simplified example)
    const nodes: CapabilityNode[] = [
      { id: '1', label: 'Core Feature', description: 'Main functionality', type: 'feature', specId: 1, parent: null, children: ['2'], status: 'ready', relatedTasks: [101], tags: ['priority'] },
      { id: '2', label: 'Sub-feature', description: 'Supporting detail', type: 'component', specId: 1, parent: '1', children: [], status: 'in_progress', relatedTasks: [102], tags: ['dependency'] }
    ];
    const tags = ['priority', 'dependency'];
    res.json({ nodes, tags });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch capabilities' });
  }
});

// GET /api/capabilities/:id/drill
router.get('/capabilities/:id/drill', async (req, res) => {
  try {
    const { id } = req.params;
    // Fetch detailed capability rollup data (simplified example)
    const rollup: CapabilityRollup = {
      spec: { id: 1, projectId: 123, task_id: null, goal: 'Core Feature', prd: 'Description...', kind: 'prd', status: 'ready', tenantId: 1, spec: null, userId: 'user1', createdAt: new Date().toISOString() },
      metrics: {
        promptCount: 15,
        userScopeCount: 5,
        userCapabilityCount: 3,
        scheduleCount: 2,
        scheduleScopeCount: 1,
        runtimeCount: 4,
        modelCount: 2,
        maxPromptSize: 2048,
        avgPromptSize: 1024,
        maxModelContext: 4096,
        maxScheduleTimeout: 30000,
        avgDurationMs: 1500
      },
      sections: [
        { id: 'section1', name: 'Requirements', description: 'Functional requirements', requirements: [{ requirementId: 'req1', title: 'User Login', description: 'Allow users to log in', status: 'ready', relatedTasks: [101] }] }
      ],
      nodes: [
        { id: '1', label: 'Core Feature', description: 'Main functionality', type: 'feature', specId: 1, parent: null, children: ['2'], status: 'ready', relatedTasks: [101], tags: ['priority'] },
        { id: '2', label: 'Sub-feature', description: 'Supporting detail', type: 'component', specId: 1, parent: '1', children: [], status: 'in_progress', relatedTasks: [102], tags: ['dependency'] }
      ],
      relationships: [
        { from: '1', to: '2', label: 'depends on', kind: 'dependency', specId: 1 }
      ]
    };
    res.json(rollup);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch capability rollup' });
  }
});

// POST /api/capabilities/:id/export
router.post('/capabilities/:id/export', async (req, res) => {
  try {
    const { id } = req.params;
    const { format, includeMetrics, includeSource, fontSizePx, formatDate } = req.body as ExportOptions;
    // Generate export content (simplified example)
    const content = `Exported capability data for ID ${id} in ${format} format.`;
    res.set('Content-Type', 'application/octet-stream');
    res.set('Content-Disposition', `attachment; filename=capability-export.${format}`);
    res.send(content);
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate export' });
  }
});

export default router;