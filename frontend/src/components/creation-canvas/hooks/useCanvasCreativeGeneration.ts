/** Generating creative output — video and the per-kind creative actions. */
import { type Dispatch, type SetStateAction, useCallback } from 'react';
import { buildBrowserCreativeArtifact, type CreationDeliverable, type CreativeArtifact, creativeBrief, EVERMIND_CREATIVE_KINDS, evermindMediaArtifact, generateEvermindMedia, generateServerCreativeArtifact, mediaFrameDataUrl, navigableArtifactUrl, SERVER_CREATIVE_KINDS, withCreationDeliverable } from '@/lib/creationDeliverables';
import { creationSessionsApi } from '@/lib/builderforceApi';
import { listEvermindModels } from '@/lib/studioModelsApi';
import { appendCanvasVideoSource, canvasVideoDuration, type CanvasVideoSource, canvasVideoSourcesFrom, canvasVideoTimelineFrom } from '@builderforce/creation-canvas-contract';
import { CREATIVE_GENERATOR_KINDS } from '@/lib/creationObjectGroups';
import { brandForNode, brandViolationsIn } from '@/lib/canvasMarketing';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { useTranslations } from 'next-intl';

export interface UseCanvasCreativeGenerationDeps {
  errorText: (error: unknown) => string;
  nodes: CanvasObject[];
  persistence: 'local' | 'server';
  requireAccount: (action: string, title: string, description: string) => void;
  selectedNode: CanvasObject | null;
  sessionId: string;
  setNodes: Dispatch<SetStateAction<CanvasObject[]>>;
  setNotice: (text: string) => void;
  t: ReturnType<typeof useTranslations<'creationCanvas'>>;
}

export function useCanvasCreativeGeneration({ errorText, nodes, persistence, requireAccount, selectedNode, sessionId, setNodes, setNotice, t }: UseCanvasCreativeGenerationDeps) {
  const generateVideo = useCallback((videoId?: string) => {
    const target = nodes.find((node) => node.id === videoId && node.data.kind === 'video')
      ?? (selectedNode?.data.kind === 'video' ? selectedNode : nodes.find((node) => node.data.kind === 'video'));
    if (!target) { setNotice(t('noticeNeedVideo')); return; }
    if (persistence !== 'server') { requireAccount('generate', 'Create an account to generate video', 'Save this session to run a published Evermind video model.'); return; }
    const deliveryId = crypto.randomUUID();
    const correlationId = `deliver:${deliveryId}`;
    const startedAt = performance.now();
    const started: CreationDeliverable = { id: deliveryId, action: 'generate', artifactKind: 'video', status: 'running', createdAt: new Date().toISOString(), provider: 'evermind' };
    setNodes((current) => current.map((node) => node.id === target.id ? { ...node, data: { ...node.data, status: 'Generating…', deliverables: withCreationDeliverable(node.data, started) } } : node));
    setNotice(t('noticeGeneratingVideo'));
    void creationSessionsApi.recordOutcome(sessionId, { correlationId, action: 'video.generate', phase: 'started', artifactId: target.id }).catch(() => undefined);
    void listEvermindModels().then((models) => {
      const configured = typeof target.data.modelSlug === 'string' ? target.data.modelSlug : typeof target.data.model === 'string' ? target.data.model : '';
      const model = models.find((candidate) => candidate.slug === configured || candidate.name === configured) ?? models[0];
      if (!model) throw new Error('Publish an Evermind video model before generating this deliverable');
      return generateEvermindMedia(model.slug, { prompt: typeof target.data.prompt === 'string' ? target.data.prompt : target.data.content as string | undefined, maxFrames: typeof target.data.maxFrames === 'number' ? target.data.maxFrames : 16 }).then((media) => ({ media, model }));
    }).then(({ media, model }) => {
      const previewUrl = media.frames[0] ? mediaFrameDataUrl(media.frames[0], media.width, media.height, media.channels) : null;
      const aiFrameDuration = 1 / Math.min(12, Math.max(1, media.frameCount));
      const aiSources: CanvasVideoSource[] = media.frames.flatMap((frame, index) => {
        const url = mediaFrameDataUrl(frame, media.width, media.height, media.channels);
        return url ? [{
          id: crypto.randomUUID(),
          kind: 'image' as const,
          captureKind: 'ai' as const,
          url,
          fileName: `${target.data.title}-${index + 1}.png`,
          mimeType: 'image/png',
          durationSeconds: aiFrameDuration,
          width: media.width,
          height: media.height,
        }] : [];
      });
      const delivered: CreationDeliverable = { ...started, status: 'delivered', completedAt: new Date().toISOString(), mimeType: media.modality === 'video' ? 'application/x-builderforce-video-frames' : 'image/png', resourceRef: media.model, validation: { status: media.frameCount > 0 ? 'passed' : 'failed', detail: `${media.frameCount} ${media.width}×${media.height} frames generated` }, metadata: { modelSlug: model.slug, frameCount: media.frameCount, width: media.width, height: media.height, channels: media.channels, usage: media.usage } };
      setNodes((current) => current.map((node) => {
        if (node.id !== target.id) return node;
        const priorSources = canvasVideoSourcesFrom(node.data.videoSources);
        const nextTimeline = aiSources.reduce((value, source) => appendCanvasVideoSource(value, source, 'visual'), canvasVideoTimelineFrom(node.data.videoTimeline));
        return { ...node, data: { ...node.data, status: 'Generated · Editable', modelSlug: model.slug, frameCount: media.frameCount, videoWidth: media.width, videoHeight: media.height, generatedFrames: media.frames, videoSources: [...priorSources, ...aiSources], videoTimeline: nextTimeline, duration: canvasVideoDuration(nextTimeline), ...(previewUrl ? { videoUrl: previewUrl } : {}), deliverables: withCreationDeliverable(node.data, delivered) } };
      }));
      setNotice(t('noticeVideoGenerated', { frames: media.frameCount, model: model.name }));
      void creationSessionsApi.recordOutcome(sessionId, { correlationId, action: 'video.generate', phase: 'succeeded', actorType: 'system', artifactId: target.id, durationMs: performance.now() - startedAt, metricKey: 'deliverables_completed', metricValue: 1, unit: 'count', metadata: { model: model.slug, frameCount: media.frameCount } }).catch(() => undefined);
    }).catch((error) => {
      const message = errorText(error);
      const failed: CreationDeliverable = { ...started, status: 'failed', completedAt: new Date().toISOString(), error: message, validation: { status: 'failed', detail: message } };
      setNodes((current) => current.map((node) => node.id === target.id ? { ...node, data: { ...node.data, status: 'Generation failed', deliverables: withCreationDeliverable(node.data, failed) } } : node));
      setNotice(message);
      void creationSessionsApi.recordOutcome(sessionId, { correlationId, action: 'video.generate', phase: 'failed', actorType: 'system', artifactId: target.id, durationMs: performance.now() - startedAt }).catch(() => undefined);
    });
  }, [errorText, nodes, persistence, requireAccount, selectedNode, sessionId, setNodes, setNotice, t]);

  const runCreativeAction = useCallback((objectId?: string, action = 'generate') => {
    const target = nodes.find((node) => node.id === objectId && CREATIVE_GENERATOR_KINDS.has(node.data.kind))
      ?? (selectedNode && CREATIVE_GENERATOR_KINDS.has(selectedNode.data.kind) ? selectedNode : undefined);
    if (!target) { setNotice(t('creativeSelectFirst')); return; }
    const existingUrl = typeof target.data.outputUrl === 'string' ? target.data.outputUrl : '';
    if ((action === 'preview' || action === 'export') && existingUrl) {
      // A browser refuses to open a `data:` URL in a top-level tab, so both paths
      // go through a navigable URL. It is revoked on a timer rather than at once:
      // revoking it before the new tab has read it is the same blank page.
      const navigable = navigableArtifactUrl(existingUrl);
      if (action === 'preview') window.open(navigable, '_blank', 'noopener,noreferrer');
      else {
        const anchor = document.createElement('a'); anchor.href = navigable;
        anchor.download = typeof target.data.outputFileName === 'string' ? target.data.outputFileName : `${target.data.title}.artifact`;
        anchor.click();
      }
      if (navigable !== existingUrl) window.setTimeout(() => URL.revokeObjectURL(navigable), 60_000);
      setNotice(action === 'preview' ? t('creativePreviewOpened') : t('creativeDownloaded'));
      return;
    }
    /**
     * The generator for this kind, best first.
     *
     * A creative brief has to produce the thing described in it, so the object goes
     * to a real generator: the tenant's own published Evermind model renders the
     * pixels, and the server generator authors the geometry, the game, the resume,
     * the script. The browser baseline stays as the LAST answer, not the only one —
     * it is what a local session, an unavailable model or a failed call falls back
     * to, so a creative object always ends up with a real, portable file.
     */
    const deliveryId = crypto.randomUUID();
    const correlationId = `deliver:${deliveryId}`;
    const startedAt = performance.now();
    const kind = target.data.kind;
    // THE BRAND THIS ARTIFACT ANSWERS TO, resolved once and given to every generator
    // below. Undefined on a board with no `brandKit`, which composes exactly as it did
    // before — see `marketing.ts` for the three resolution rules and why an unresolved
    // binding composes unbranded rather than borrowing the other kit.
    const brand = brandForNode(target, nodes);
    const started: CreationDeliverable = { id: deliveryId, action, artifactKind: kind, status: 'running', createdAt: new Date().toISOString() };
    setNodes((current) => current.map((node) => node.id === target.id ? { ...node, data: { ...node.data, status: t('creativeGenerating'), deliverables: withCreationDeliverable(node.data, started) } } : node));
    setNotice(t('creativeGenerating'));
    if (persistence === 'server') {
      void creationSessionsApi.recordOutcome(sessionId, { correlationId, action: `creative.${action}`, phase: 'started', artifactId: target.id }).catch(() => undefined);
    }

    const generate = async (): Promise<CreativeArtifact> => {
      if (persistence === 'server' && EVERMIND_CREATIVE_KINDS.has(kind)) {
        const models = await listEvermindModels();
        const configured = typeof target.data.modelSlug === 'string' ? target.data.modelSlug : '';
        const model = models.find((candidate) => candidate.slug === configured || candidate.name === configured) ?? models[0];
        if (!model) throw new Error(t('creativeNoMediaModel'));
        const media = await generateEvermindMedia(model.slug, {
          prompt: creativeBrief(target.data, brand),
          maxFrames: kind === 'animation' ? 24 : 1,
        });
        const rendered = evermindMediaArtifact(target.data, media, model.slug);
        if (!rendered) throw new Error(t('creativeNoFrames'));
        return rendered;
      }
      if (persistence === 'server' && SERVER_CREATIVE_KINDS.has(kind)) return generateServerCreativeArtifact(target.data, brand);
      return { ...buildBrowserCreativeArtifact(target.data, brand), provider: 'builderforce-browser' };
    };

    void generate()
      .then((artifact) => ({ artifact, fellBack: false }))
      // A generator that is unavailable must not leave the object empty: the
      // browser baseline is a real file, and saying which one produced it is the
      // difference between a fallback and a silent downgrade.
      .catch(() => ({ artifact: { ...buildBrowserCreativeArtifact(target.data, brand), provider: 'builderforce-browser' } as CreativeArtifact, fellBack: true }))
      .then(({ artifact, fellBack }) => {
        // ── THE CHECK HALF OF THE BRAND BINDING ────────────────────────────────
        // The directive told the generator what it may not claim. This asks whether it
        // listened. An instruction a model ignored and nothing verified is precisely the
        // on-brand-BY-REVIEW failure the binding exists to replace, so a violated claim
        // fails the deliverable's validation and NAMES the phrase — a warning nobody can
        // act on is the same product with a paper trail.
        const violations = brandViolationsIn([artifact.summary, artifact.fileName, target.data.prompt, target.data.content].join(' '), target, nodes);
        const delivered: CreationDeliverable = {
          ...started, artifactKind: artifact.artifactKind, status: 'delivered', completedAt: new Date().toISOString(),
          url: artifact.url, mimeType: artifact.mimeType, fileName: artifact.fileName, provider: artifact.provider,
          validation: violations.length
            ? { status: 'failed', detail: t('brandClaimViolation', { claims: violations.join('; ') }) }
            : { status: 'passed', detail: artifact.validationDetail },
          metadata: { outputFormat: artifact.outputFormat, capabilityId: target.data.capabilityId, ...(artifact.model ? { model: artifact.model } : {}) },
        };
        // The tile shows the preview the artifact came with, and nothing when it
        // has none — a stale thumbnail from an earlier generation would
        // misdescribe the file that is now attached.
        setNodes((current) => current.map((node) => node.id === target.id ? { ...node, data: {
          ...node.data,
          status: action === 'apply' ? t('creativeApplied') : t('creativeGeneratedStatus'),
          outputUrl: artifact.url,
          outputFormat: artifact.outputFormat,
          outputFileName: artifact.fileName,
          outputMimeType: artifact.mimeType,
          provider: artifact.provider,
          ...(artifact.summary ? { subtitle: artifact.summary } : {}),
          thumbnailUrl: artifact.previewImageUrl ?? '',
          deliverables: withCreationDeliverable(node.data, delivered),
        } } : node));
        setNotice(violations.length
          ? t('brandClaimViolation', { claims: violations.join('; ') })
          : fellBack ? t('creativeGeneratedOffline', { file: artifact.fileName }) : t('creativeGenerated', { file: artifact.fileName }));
        if (persistence === 'server') {
          void creationSessionsApi.recordOutcome(sessionId, { correlationId, action: `creative.${action}`, phase: 'succeeded', actorType: 'system', artifactId: target.id, durationMs: performance.now() - startedAt, metricKey: 'deliverables_completed', metricValue: 1, unit: 'count', metadata: { provider: artifact.provider, outputFormat: artifact.outputFormat } }).catch(() => undefined);
        }
      });
  }, [nodes, persistence, selectedNode, sessionId, setNodes, setNotice, t]);
  return { generateVideo, runCreativeAction };
}
