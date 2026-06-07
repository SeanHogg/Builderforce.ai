/**
 * ArchitectAnalysisService — turns an EvidenceBundle (sampled repo content)
 * into the six Digital-Transformation artifacts via the builderforceLLM
 * gateway. One method per artifact, each pure of the database: the
 * AnalysisRunnerDO owns persistence + ordering, so this service stays a clean,
 * agent-wrappable unit (the future "Architect Agent" calls these directly).
 *
 * Generation uses response_format json_object (the free model pool's reliable
 * structured mode, as in QaGeneratorService) with the exact JSON shape spelled
 * out in each system prompt; output is parsed defensively and rendered into
 * deterministic Markdown so even a weak model produces a clean artifact.
 */
import { ideProxy } from '../llm/LlmProxyService';
import type { Env } from '../../env';
import type {
  ArtifactKind,
  EvidenceBundle,
  GeneratedArtifact,
  RepoEvidence,
} from './types';

/** Per-artifact output-token ceilings — keep prompt+output within tier budget. */
const MAX_TOKENS: Record<ArtifactKind, number> = {
  diagnostic: 800,
  recommendation: 900,
  business: 700,
  arch_4plus1: 1900,
  antipatterns: 1200,
  principles: 1200,
};

export class ArtifactGenerationError extends Error {
  constructor(public readonly kind: ArtifactKind, message: string) {
    super(`[${kind}] ${message}`);
    this.name = 'ArtifactGenerationError';
  }
}

export class ArchitectAnalysisService {
  /**
   * @param preferredModel  When an agent is assigned to architecture analysis
   *   for this project, its model id (e.g. `workforce-<id>`) so the run executes
   *   AS that agent; omitted → the gateway's default cascade.
   */
  constructor(private readonly env: Env, private readonly preferredModel?: string) {}

  // ── public generators ─────────────────────────────────────────────────────

  async generate(
    kind: ArtifactKind,
    bundle: EvidenceBundle,
    priors: Partial<Record<ArtifactKind, GeneratedArtifact>> = {},
  ): Promise<GeneratedArtifact> {
    switch (kind) {
      case 'diagnostic':     return this.generateDiagnostic(bundle);
      case 'recommendation': return this.generateRecommendation(bundle, priors);
      case 'business':       return this.generateBusiness(bundle, priors);
      case 'arch_4plus1':    return this.generate4plus1(bundle);
      case 'antipatterns':   return this.generateAntiPatterns(bundle);
      case 'principles':     return this.generatePrinciples(bundle);
      default:               throw new ArtifactGenerationError(kind, 'unknown artifact kind');
    }
  }

  private async generateDiagnostic(bundle: EvidenceBundle): Promise<GeneratedArtifact> {
    const system =
      `You are a principal software architect onboarding onto an unfamiliar codebase. ` +
      `Diagnose what the repository (or repositories together) actually does, for a technical reader. ` +
      `Reply ONLY with a JSON object of this exact shape:\n` +
      `{"summary": string, "purpose": string, "primaryLanguages": string[], "frameworks": string[], ` +
      `"keyComponents": [{"name": string, "responsibility": string}], ` +
      `"suggestedProjectDescription": string (<= 280 chars, suitable as the project's description field), ` +
      `"suggestedModality": "designer"|"architect"|"developer"}`;
    const obj = await this.runJson('diagnostic', system, this.renderEvidence(bundle));
    const data = obj.json as DiagnosticData;
    const body = [
      `# What This ${bundle.repos.length > 1 ? 'System' : 'Repository'} Does`,
      ``,
      str(data.summary),
      ``,
      `## Purpose`,
      str(data.purpose),
      ``,
      `## Stack`,
      `- **Languages:** ${list(data.primaryLanguages)}`,
      `- **Frameworks:** ${list(data.frameworks)}`,
      ``,
      `## Key Components`,
      ...(arr<{ name?: string; responsibility?: string }>(data.keyComponents).map(
        (c) => `- **${str(c?.name)}** — ${str(c?.responsibility)}`,
      )),
    ].join('\n');
    return {
      kind: 'diagnostic',
      title: 'Repository Diagnostic',
      bodyMd: body,
      dataJson: JSON.stringify(data),
      model: obj.model,
      tokens: obj.tokens,
      suggestedProjectDescription: typeof data.suggestedProjectDescription === 'string'
        ? data.suggestedProjectDescription.slice(0, 280)
        : undefined,
      suggestedModality: VALID_MODALITY.has(String(data.suggestedModality))
        ? String(data.suggestedModality)
        : undefined,
    };
  }

  private async generateRecommendation(
    bundle: EvidenceBundle,
    priors: Partial<Record<ArtifactKind, GeneratedArtifact>>,
  ): Promise<GeneratedArtifact> {
    const system =
      `You are a digital-transformation advisor. Given the codebase evidence (and the prior diagnostic), ` +
      `decide the modernization strategy: "brownfield" (improve in place), "greenfield" (extract & rebuild new), ` +
      `or "parallel" (run old and new side by side / strangler-fig). Be decisive and justify with evidence. ` +
      `Reply ONLY with JSON of this exact shape:\n` +
      `{"recommendation": "brownfield"|"greenfield"|"parallel", "rationale": string, ` +
      `"risks": string[], "firstSteps": string[], "brownfieldScore": number, "greenfieldScore": number}`;
    const user = this.renderEvidence(bundle) + this.renderPrior('Diagnostic', priors.diagnostic);
    const obj = await this.runJson('recommendation', system, user);
    const data = obj.json as RecommendationData;
    const rec = (['brownfield', 'greenfield', 'parallel'] as const).includes(data.recommendation as never)
      ? (data.recommendation as 'brownfield' | 'greenfield' | 'parallel')
      : 'brownfield';
    const body = [
      `# Recommendation: ${rec.toUpperCase()}`,
      ``,
      str(data.rationale),
      ``,
      `## Risks`,
      ...(arr(data.risks).map((r) => `- ${str(r)}`)),
      ``,
      `## First Steps`,
      ...(arr(data.firstSteps).map((s, i) => `${i + 1}. ${str(s)}`)),
    ].join('\n');
    return {
      kind: 'recommendation',
      title: 'Modernization Recommendation',
      bodyMd: body,
      dataJson: JSON.stringify({ ...data, recommendation: rec }),
      model: obj.model,
      tokens: obj.tokens,
      recommendation: rec,
    };
  }

  private async generateBusiness(
    bundle: EvidenceBundle,
    priors: Partial<Record<ArtifactKind, GeneratedArtifact>>,
  ): Promise<GeneratedArtifact> {
    const system =
      `You are a product strategist explaining a software system to non-technical business stakeholders. ` +
      `Avoid jargon. Reply ONLY with JSON of this exact shape:\n` +
      `{"summary": string, "audience": string, "valueProps": string[], "capabilities": string[]}`;
    const user = this.renderEvidence(bundle) + this.renderPrior('Diagnostic', priors.diagnostic);
    const obj = await this.runJson('business', system, user);
    const data = obj.json as BusinessData;
    const body = [
      `# Business Summary`,
      ``,
      str(data.summary),
      ``,
      `**Who it serves:** ${str(data.audience)}`,
      ``,
      `## Value`,
      ...(arr(data.valueProps).map((v) => `- ${str(v)}`)),
      ``,
      `## Capabilities`,
      ...(arr(data.capabilities).map((c) => `- ${str(c)}`)),
    ].join('\n');
    return {
      kind: 'business',
      title: 'Business Summary',
      bodyMd: body,
      dataJson: JSON.stringify(data),
      model: obj.model,
      tokens: obj.tokens,
    };
  }

  private async generate4plus1(bundle: EvidenceBundle): Promise<GeneratedArtifact> {
    const system =
      `You are a software architect documenting a system with Kruchten's 4+1 architectural view model. ` +
      `Produce all five views. Each view has prose AND a Mermaid diagram (valid Mermaid syntax — ` +
      `logical/development: classDiagram or flowchart; process: sequenceDiagram or flowchart; ` +
      `physical: flowchart; scenarios: sequenceDiagram). Keep diagrams modest (<= ~12 nodes). ` +
      `Reply ONLY with JSON of this exact shape:\n` +
      `{"logical": {"markdown": string, "mermaid": string}, "process": {"markdown": string, "mermaid": string}, ` +
      `"development": {"markdown": string, "mermaid": string}, "physical": {"markdown": string, "mermaid": string}, ` +
      `"scenarios": {"markdown": string, "mermaid": string}}`;
    const obj = await this.runJson('arch_4plus1', system, this.renderEvidence(bundle));
    const data = obj.json as FourPlusOneData;
    const view = (label: string, v?: ArchView): string =>
      [`## ${label} View`, str(v?.markdown), ``, fencedMermaid(v?.mermaid), ``].join('\n');
    const body = [
      `# 4+1 Architecture Views`,
      ``,
      view('Logical', data.logical),
      view('Process', data.process),
      view('Development', data.development),
      view('Physical', data.physical),
      view('Scenarios (+1)', data.scenarios),
    ].join('\n');
    return {
      kind: 'arch_4plus1',
      title: '4+1 Architecture Views',
      bodyMd: body,
      dataJson: JSON.stringify(data),
      model: obj.model,
      tokens: obj.tokens,
    };
  }

  private async generateAntiPatterns(bundle: EvidenceBundle): Promise<GeneratedArtifact> {
    const system =
      `You are a senior code reviewer auditing for anti-patterns (e.g. god object, big ball of mud, ` +
      `circular deps, copy-paste, tight coupling, missing tests, leaky abstractions). Ground each finding ` +
      `in the evidence. Reply ONLY with JSON of this exact shape:\n` +
      `{"findings": [{"name": string, "severity": "low"|"medium"|"high", "evidence": string, "recommendation": string}]}`;
    const obj = await this.runJson('antipatterns', system, this.renderEvidence(bundle));
    const data = obj.json as AntiPatternsData;
    const rows = arr<{ name?: string; severity?: string; evidence?: string; recommendation?: string }>(
      data.findings,
    ).map((f) => `| ${str(f?.name)} | ${str(f?.severity)} | ${str(f?.evidence)} | ${str(f?.recommendation)} |`);
    const body = [
      `# Anti-Patterns Report`,
      ``,
      rows.length
        ? ['| Finding | Severity | Evidence | Recommendation |', '|---|---|---|---|', ...rows].join('\n')
        : `_No significant anti-patterns detected in the sampled evidence._`,
    ].join('\n');
    return {
      kind: 'antipatterns',
      title: 'Anti-Patterns Report',
      bodyMd: body,
      dataJson: JSON.stringify(data),
      model: obj.model,
      tokens: obj.tokens,
    };
  }

  private async generatePrinciples(bundle: EvidenceBundle): Promise<GeneratedArtifact> {
    const system =
      `You are an architecture reviewer assessing adherence to design principles. Score each 0-10 with notes ` +
      `grounded in evidence. Also identify notable design patterns in use. Reply ONLY with JSON of this exact shape:\n` +
      `{"dry": {"score": number, "notes": string}, "solid": {"score": number, "notes": string}, ` +
      `"ddd": {"score": number, "notes": string}, "patterns": {"score": number, "notes": string, "detected": string[]}}`;
    const obj = await this.runJson('principles', system, this.renderEvidence(bundle));
    const data = obj.json as PrinciplesData;
    const line = (label: string, p?: PrincipleScore): string =>
      `- **${label}** (${num(p?.score)}/10): ${str(p?.notes)}`;
    const body = [
      `# Design Principles Assessment`,
      ``,
      line('DRY', data.dry),
      line('SOLID', data.solid),
      line('DDD', data.ddd),
      line('Patterns', data.patterns),
      ``,
      data.patterns?.detected?.length ? `**Detected patterns:** ${list(data.patterns.detected)}` : '',
    ].join('\n');
    return {
      kind: 'principles',
      title: 'Design Principles Assessment',
      bodyMd: body,
      dataJson: JSON.stringify(data),
      model: obj.model,
      tokens: obj.tokens,
    };
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /** Call the gateway, parse the JSON object, surface model + token usage. */
  private async runJson(
    kind: ArtifactKind,
    system: string,
    user: string,
  ): Promise<{ json: Record<string, unknown>; model: string | null; tokens: number }> {
    if (!this.env.OPENROUTER_API_KEY?.trim()) {
      throw new ArtifactGenerationError(kind, 'LLM gateway not configured (OPENROUTER_API_KEY unset)');
    }
    let result;
    try {
      result = await ideProxy(this.env).complete({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.2,
        max_tokens: MAX_TOKENS[kind],
        response_format: { type: 'json_object' },
        useCase: `repo_analysis_${kind}`,
        // Run as the assigned architecture agent when one is set (else default cascade).
        ...(this.preferredModel ? { model: this.preferredModel } : {}),
      });
    } catch (err) {
      throw new ArtifactGenerationError(kind, `gateway call failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (result.response.status >= 400) {
      throw new ArtifactGenerationError(kind, `gateway returned ${result.response.status}`);
    }
    const raw = await result.response.json().catch(() => null);
    const content = extractContent(raw);
    const json = content ? parseJsonObject(content) : null;
    if (!json) throw new ArtifactGenerationError(kind, 'model returned unparseable JSON');
    return { json, model: result.resolvedModel ?? null, tokens: result.usage?.totalTokens ?? 0 };
  }

  /** Render the evidence bundle into a compact, prompt-friendly block. */
  private renderEvidence(bundle: EvidenceBundle): string {
    const parts: string[] = [`Project: ${bundle.projectName}`, `Repositories: ${bundle.repos.length}`, ''];
    for (const r of bundle.repos) parts.push(this.renderRepo(r));
    return parts.join('\n');
  }

  private renderRepo(r: RepoEvidence): string {
    const langs = Object.entries(r.languages)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k, v]) => `${k}(${v})`)
      .join(', ');
    const commits = r.recentCommits.slice(0, 10).map((c) => `- ${c.message.split('\n')[0]}`).join('\n');
    const files = r.sampledFiles
      .map((f) => `### ${f.path}${f.truncated ? ' (truncated)' : ''}\n\`\`\`\n${f.content}\n\`\`\``)
      .join('\n\n');
    return [
      `## Repo: ${r.provider}:${r.owner}/${r.repo} (branch ${r.defaultBranch})`,
      `Languages: ${langs || 'unknown'}`,
      `Files: ${r.treeSummary.fileCount}${r.treeSummary.truncated ? '+ (tree truncated)' : ''}; top dirs: ${r.treeSummary.topDirs.join(', ')}`,
      r.recentCommits.length ? `Recent commits:\n${commits}` : '',
      ``,
      `Sampled files:`,
      files,
      ``,
    ].join('\n');
  }

  private renderPrior(label: string, art?: GeneratedArtifact): string {
    if (!art) return '';
    return `\n\n--- Prior ${label} (for context) ---\n${art.dataJson}\n`;
  }
}

// ── pure helpers ─────────────────────────────────────────────────────────────

const VALID_MODALITY = new Set(['designer', 'architect', 'developer']);

function extractContent(raw: unknown): string | null {
  const choices = (raw as { choices?: Array<{ message?: { content?: unknown } }> } | null)?.choices;
  const content = choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : null;
}

/** Strip ```...``` fences and parse the first balanced JSON object. */
function parseJsonObject(content: string): Record<string, unknown> | null {
  let s = content.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(s);
  if (fence?.[1]) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function fencedMermaid(code: unknown): string {
  const c = typeof code === 'string' ? code.trim() : '';
  return c ? '```mermaid\n' + c + '\n```' : '';
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}
function num(v: unknown): string {
  return typeof v === 'number' && Number.isFinite(v) ? String(v) : '–';
}
function list(v: unknown): string {
  return Array.isArray(v) && v.length ? v.map(str).join(', ') : '—';
}
function arr<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

// ── parsed-shape types (best-effort; all fields optional) ────────────────────

interface DiagnosticData {
  summary?: string; purpose?: string; primaryLanguages?: string[]; frameworks?: string[];
  keyComponents?: { name?: string; responsibility?: string }[];
  suggestedProjectDescription?: string; suggestedModality?: string;
}
interface RecommendationData {
  recommendation?: string; rationale?: string; risks?: string[]; firstSteps?: string[];
  brownfieldScore?: number; greenfieldScore?: number;
}
interface BusinessData { summary?: string; audience?: string; valueProps?: string[]; capabilities?: string[] }
interface ArchView { markdown?: string; mermaid?: string }
interface FourPlusOneData {
  logical?: ArchView; process?: ArchView; development?: ArchView; physical?: ArchView; scenarios?: ArchView;
}
interface AntiPatternsData {
  findings?: { name?: string; severity?: string; evidence?: string; recommendation?: string }[];
}
interface PrincipleScore { score?: number; notes?: string; detected?: string[] }
interface PrinciplesData { dry?: PrincipleScore; solid?: PrincipleScore; ddd?: PrincipleScore; patterns?: PrincipleScore }
