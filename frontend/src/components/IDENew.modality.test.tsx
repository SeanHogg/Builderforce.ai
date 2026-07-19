import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

/**
 * Center-panel modality switch regression (Consolidated Gap Register #143).
 *
 * modality.test.ts locks the registry FLAGS (evermind + finetune stay enabled),
 * but nothing rendered IDENew to prove the center panel actually mounts the
 * right component per modality:
 *
 *   video    → <StudioPanel>            (@seanhogg/builderforce-studio-embedded)
 *   evermind → <EvermindStudioPanel>    (no active file → the studio panel, not code)
 *   finetune → <FinetuneStudioPanel>    (no active file → the studio panel, not code)
 *   designer → preview/code view        (the Preview/Code toggle chrome)
 *
 * IDENew pulls in WebContainer / collaboration / brain / a dozen side panels —
 * all irrelevant to the center-panel decision — so we mock them to sentinels
 * and assert ONLY which center component renders for each `project.modality`.
 */

// --- Center-panel sentinels (the thing under test) -------------------------
vi.mock('@seanhogg/builderforce-studio-embedded', () => ({
  StudioPanel: () => <div data-testid="center-studio-panel" />,
}));
// The bare CSS side-effect import (`.../styles.css`) is handled by vitest's
// default CSS handling; no module mock is needed.
vi.mock('./EvermindStudioPanel', () => ({
  EvermindStudioPanel: () => <div data-testid="center-evermind-panel" />,
}));
vi.mock('./FinetuneStudioPanel', () => ({
  FinetuneStudioPanel: () => <div data-testid="center-finetune-panel" />,
}));

// --- Heavy collaborators, mocked to inert stubs ----------------------------
vi.mock('@/hooks/useWebContainer', () => ({
  useWebContainer: () => ({
    state: { status: 'idle' },
    mountFiles: vi.fn(),
    runCommand: vi.fn(),
    runCommandAndWait: vi.fn(),
    readDirRecursive: vi.fn(),
    writeFileToContainer: vi.fn(),
    startShell: vi.fn(),
    startDevServer: vi.fn(),
    getOrBootWebContainer: vi.fn(),
  }),
}));
vi.mock('@/hooks/useCollaboration', () => ({
  useCollaboration: () => ({ doc: null, provider: null, connected: false }),
}));
vi.mock('@/hooks/useVideoVersions', () => ({
  useVideoVersions: () => ({
    versions: [],
    onSaveVersion: vi.fn(),
    onLoadVersion: vi.fn(),
  }),
}));

vi.mock('@/lib/brain', () => ({
  useRegisterBrainActions: () => {},
  useBrainContext: () => ({ setContext: vi.fn(), setOpen: vi.fn() }),
  useOptionalBrainContext: () => null,
  savePrd: vi.fn(),
  saveTasks: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  saveFile: vi.fn(),
  fetchFileContent: vi.fn(async () => ''),
  deleteFile: vi.fn(),
  fetchFiles: vi.fn(async () => []),
  updateProject: vi.fn(async () => ({})),
}));
vi.mock('@/lib/auth', () => ({ getStoredTenantToken: () => 'tok' }));
vi.mock('@/lib/apiClient', () => ({ getApiBaseUrl: () => 'http://test' }));
vi.mock('@/components/ConfirmProvider', () => ({ useConfirm: () => vi.fn(async () => true) }));

// --- The remaining side panels / chrome: render nothing --------------------
vi.mock('./FileExplorer', () => ({ FileExplorer: () => <div /> }));
vi.mock('./CodePane', () => ({ CodePane: () => <div data-testid="center-code-pane" /> }));
vi.mock('./Terminal', () => ({ Terminal: () => <div /> }));
vi.mock('./AITrainingPanel', () => ({ AITrainingPanel: () => <div /> }));
vi.mock('./AgentPublishPanel', () => ({ AgentPublishPanel: () => <div /> }));
vi.mock('./SitePublishPanel', () => ({ SitePublishPanel: () => <div /> }));
vi.mock('./AgentStateViewer', () => ({ AgentStateViewer: () => <div /> }));
vi.mock('./PreviewFrame', () => ({ PreviewFrame: () => <div data-testid="center-preview-frame" /> }));
vi.mock('./ide/DevicePreview', () => ({ DevicePreview: () => <div data-testid="center-device-preview" /> }));
vi.mock('./ide/MobileDevicePanel', () => ({ MobileDevicePanel: () => <div data-testid="mobile-device-panel" /> }));
vi.mock('./ide/IdeProjectsSlideOutPanel', () => ({ IdeProjectsSlideOutPanel: () => <div /> }));
vi.mock('./brain/BrainPanel', () => ({ BrainPanel: () => <div /> }));
vi.mock('./IdeSettingsPanel', () => ({ IdeSettingsPanel: () => <div /> }));
vi.mock('./ArtifactReviewModals', () => ({
  PrdReviewModal: () => <div />,
  TasksReviewModal: () => <div />,
}));

// Import AFTER mocks are registered.
import { IDE } from './IDENew';
import type { Project } from '@/lib/types';

function makeProject(modality: string): Project {
  return {
    id: 1,
    name: 'Test',
    modality,
  } as unknown as Project;
}

describe('IDENew center-panel modality switch', () => {
  beforeEach(() => cleanup());

  it('video modality mounts <StudioPanel>', () => {
    render(<IDE project={makeProject('video')} initialFiles={[]} />);
    expect(screen.getByTestId('center-studio-panel')).toBeTruthy();
    expect(screen.queryByTestId('center-evermind-panel')).toBeNull();
  });

  it('evermind modality (no active file) mounts <EvermindStudioPanel>', () => {
    render(<IDE project={makeProject('evermind')} initialFiles={[]} />);
    expect(screen.getByTestId('center-evermind-panel')).toBeTruthy();
    expect(screen.queryByTestId('center-finetune-panel')).toBeNull();
    expect(screen.queryByTestId('center-studio-panel')).toBeNull();
  });

  it('finetune modality (no active file) mounts <FinetuneStudioPanel>', () => {
    render(<IDE project={makeProject('finetune')} initialFiles={[]} />);
    expect(screen.getByTestId('center-finetune-panel')).toBeTruthy();
    expect(screen.queryByTestId('center-evermind-panel')).toBeNull();
    expect(screen.queryByTestId('center-studio-panel')).toBeNull();
  });

  // Legacy `llm` projects predate the split; getModality aliases them to evermind,
  // so IDENew must mount the Evermind studio for them.
  it('legacy llm modality mounts <EvermindStudioPanel>', () => {
    render(<IDE project={makeProject('llm')} initialFiles={[]} />);
    expect(screen.getByTestId('center-evermind-panel')).toBeTruthy();
    expect(screen.queryByTestId('center-finetune-panel')).toBeNull();
  });

  it('designer modality mounts the preview/code view, not a studio panel', () => {
    render(<IDE project={makeProject('designer')} initialFiles={[]} />);
    expect(screen.queryByTestId('center-studio-panel')).toBeNull();
    expect(screen.queryByTestId('center-evermind-panel')).toBeNull();
    expect(screen.queryByTestId('center-finetune-panel')).toBeNull();
    // The designer center is the Preview frame (default centerView = 'preview').
    expect(screen.getByTestId('center-preview-frame')).toBeTruthy();
    // ...and it has no device slide-out; that belongs to Mobile.
    expect(screen.queryByTestId('mobile-device-panel')).toBeNull();
  });

  // Mobile shares Designer's Preview/Code chrome but frames the preview in a
  // device bezel, so the swap has to be the DevicePreview and not the plain one.
  it('mobile modality mounts the device preview instead of the plain frame', () => {
    render(<IDE project={makeProject('mobile')} initialFiles={[]} />);
    expect(screen.getByTestId('center-device-preview')).toBeTruthy();
    expect(screen.queryByTestId('center-preview-frame')).toBeNull();
    expect(screen.queryByTestId('center-studio-panel')).toBeNull();
  });

  it('mobile modality mounts the scan-to-phone slide-out', () => {
    render(<IDE project={makeProject('mobile')} initialFiles={[]} />);
    expect(screen.getByTestId('mobile-device-panel')).toBeTruthy();
  });
});
