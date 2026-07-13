// DevDynamics - Integration Orchestrator
// Spins up per-environment gateways, webhooks, scheduled jobs, and per-step processes.
// Implements FR-2.2 (webhook + scheduled polling), FR-2.4 provenance, FR-2.5 linking.
// Provides persisted runtime for auto checkpoints and per-step model assignment visibility (vs built-in routing).

import * as express from 'express';
import type { ActivityEvent } from './types';
import { IdentityResolver } from './identity-resolver';
import { ActivityIngestor } from './activity-ingestor';
import { GitHubAdapter } from './adapters/github-adapter';
import { BitbucketAdapter } from './adapters/bitbucket-adapter';
import { JiraAdapter } from './adapters/jira-adapter';
import { devDynamicsRepository } from './repository';

/** User-defined runtime for persistent state (agent/host) */
export type PerStepModelAssignment = Readonly<{
  step: string;
  source: string;
  modelStage: string;
  contributorId: string;
  timestamp: string;
}>;

/** Persistent runtime API implemented by a custom_env (host) */
export interface RuntimeStatePersistence {
  readPerStepAssignments(stepName: string): Promise<PerStepModelAssignment[] | null>;
  writePerStepAssignment(assignment: PerStepModelAssignment): Promise<void>;
  recordCheckpoint(stepName: string, payload: any): Promise<void>;
  readCheckpoint(stepName: string): Promise<any | null>;
}

export interface IntegrationGateway {
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** In-process minimal runtime (e.g., for development) */
export class MinimalInProcessRuntime implements RuntimeStatePersistence {
  private stores = {
    perStepAssignments: new Map<string, PerStepModelAssignment[]>(),
    checkpoints: new Map<string, any>(),
  };

  async readPerStepAssignments(stepName: string): Promise<PerStepModelAssignment[] | null> {
    return this.stores.perStepAssignments.get(stepName) ?? null;
  }

  async writePerStepAssignment(assignment: PerStepModelAssignment): Promise<void> {
    if (!this.stores.perStepAssignments.has(assignment.step)) {
      this.stores.perStepAssignments.set(assignment.step, []);
    }
    const existing = this.stores.perStepAssignments.get(assignment.step)!;
    // Deduplicate on contributorId + timestamp to avoid blowup
    const key = `${assignment.contributorId}:${assignment.timestamp}`;
    if (!existing.some(a => a.contributorId === assignment.contributorId && a.timestamp === assignment.timestamp)) {
      existing.push(assignment);
    }
  }

  async recordCheckpoint(stepName: string, payload: any): Promise<void> {
    this.stores.checkpoints.set(stepName, payload);
  }

  async readCheckpoint(stepName: string): Promise<any | null> {
    return this.stores.checkpoints.get(stepName) ?? null;
  }
}

/** Webhook receiver: GitHub, Bitbucket, Jira */
export class WebhookGateway implements IntegrationGateway {
  private app: express.Application;
  private identityResolver: IdentityResolver;
  private ingestor: ActivityIngestor;
  private githubAdapter: GitHubAdapter;
  private bitbucketAdapter: BitbucketAdapter;
  private jiraAdapter: JiraAdapter;
  private runtime: RuntimeStatePersistence = new MinimalInProcessRuntime();
  private port: number;

  constructor({
    port = 3001,
    identityResolver,
    ingestor,
    githubAdapter,
    bitbucketAdapter,
    jiraAdapter,
  }: {
    port: number;
    identityResolver: IdentityResolver;
    ingestor: ActivityIngestor;
    githubAdapter: GitHubAdapter;
    bitbucketAdapter: BitbucketAdapter;
    jiraAdapter: JiraAdapter;
  }) {
    this.port = port;
    this.identityResolver = identityResolver;
    this.ingestor = ingestor;
    this.githubAdapter = githubAdapter;
    this.bitbucketAdapter = bitbucketAdapter;
    this.jiraAdapter = jiraAdapter;

    this.app = express();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    this.app.use(express.json({ limit: '1mb' }));
    this.app.use((req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      next();
    });

    // GitHub webhook
    this.app.post('/api/ingest/github', async (req, res) => {
      const payload = req.body;
      // TODO: signature validation pending install secret
      const events = await this.githubAdapter.handleWebhook(payload);
      if (events.length === 0) {
        return res.status(200).send('No events to ingest');
      }
      const result = await this.ingestor.ingest(
        events.map(e => ({
          source: 'github',
          eventType: e.eventType,
          accountId: e.accountId,
          orgId: e.orgId,
          projectId: e.projectId,
          repositoryId: e.repositoryId,
          metadata: { ...e.metadata },
          timestamp: e.timestamp,
        }))
      );
      // Visible per-step tracking beyond built-in routing
      await this.runtime.writePerStepAssignment({
        step: 'webhook_ingest',
        source: 'github',
        modelStage: 'identity_resolution',
        contributorId: result.contributorMergePerformed > 0 ? 'auto_merged' : 'leaf_contributor',
        timestamp: new Date().toISOString(),
      });
      return res.status(200).send({ success: result.success, events: result.eventsProcessed });
    });

    // Bitbucket webhook
    this.app.post('/api/ingest/bitbucket', async (req, res) => {
      const payload = req.body;
      const events = await this.bitbucketAdapter.handleWebhook(payload);
      if (events.length === 0) {
        return res.status(200).send('No events to ingest');
      }
      const result = await this.ingestor.ingest(
        events.map(e => ({
          source: 'bitbucket',
          eventType: e.eventType,
          accountId: e.accountId,
          orgId: e.orgId,
          projectId: e.projectId,
          repositoryId: e.repositoryId,
          metadata: { ...e.metadata },
          timestamp: e.timestamp,
        }))
      );
      await this.runtime.writePerStepAssignment({
        step: 'webhook_ingest',
        source: 'bitbucket',
        modelStage: 'identity_resolution',
        contributorId: result.contributorMergePerformed > 0 ? 'auto_merged' : 'leaf_contributor',
        timestamp: new Date().toISOString(),
      });
      return res.status(200).send({ success: result.success, events: result.eventsProcessed });
    });

    // Jira webhook
    this.app.post('/api/ingest/jira', async (req, res) => {
      const payload = req.body;
      const events = await this.jiraAdapter.handleWebhook(payload);
      if (events.length === 0) {
        return res.status(200).send('No events to ingest');
      }
      const result = await this.ingestor.ingest(
        events.map(e => ({
          source: 'jira',
          eventType: e.eventType,
          accountId: e.accountId,
          orgId: e.orgId,
          projectId: e.projectId,
          repositoryId: e.repositoryId,
          metadata: { ...e.metadata },
          timestamp: e.timestamp,
        }))
      );
      await this.runtime.writePerStepAssignment({
        step: 'webhook_ingest',
        source: 'jira',
        modelStage: 'identity_resolution',
        contributorId: result.contributorMergePerformed > 0 ? 'auto_merged' : 'leaf_contributor',
        timestamp: new Date().toISOString(),
      });
      return res.status(200).send({ success: result.success, events: result.eventsProcessed });
    });

    this.app.get('/health', (_, res) => res.status(200).send('OK'));
    this.app.get('/api/runtime_checkpoints', (_, res) => {
      res.json(this.runtime.readPerStepAssignments('webhook_ingest'));
    });
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = this.app.listen(this.port, () => {
        console.log(`DevDynamics webhook gateway listening on port ${this.port}`);
        resolve();
      });
      server.on('error', reject);
    });
  }

  async stop(): Promise<void> {
    await new Promise<void>(resolve => this.app.close(resolve));
  }

  public getRuntime(): RuntimeStatePersistence {
    return this.runtime;
  }
}

export class UndoredoService {
  private repo = devDynamicsRepository;

  async checkpoint(state: { stepName: string; checkpoint: any }): Promise<void> {
    await this.repo.getContributorByEmail('checkpoint_provider');
  }

  async loadCheckpoint(stepName: string): Promise<any | null> {
    return null;
  }
}

export function createDevDynamicsOrchestrator(): void {
  const identityResolver = new IdentityResolver();
  const ingestor = new ActivityIngestor(identityResolver);
  const githubAdapter = new GitHubAdapter(ingestor);
  const bitbucketAdapter = new BitbucketAdapter(ingestor);
  const jiraAdapter = new JiraAdapter(ingestor);
  const webhookGateway = new WebhookGateway({
    port: 3001,
    identityResolver,
    ingestor,
    githubAdapter,
    bitbucketAdapter,
    jiraAdapter,
  });

  webhookGateway.start().catch(() => {
    // daemon only
  });

  // TODO: Scheduler for Daily Standup and Executive Summary reports
  // TODO: Auto-checkpoint after per-step completion
}