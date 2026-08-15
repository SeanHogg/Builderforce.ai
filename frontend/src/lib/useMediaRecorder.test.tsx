// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMediaRecorderSink } from './useMediaRecorder';
import { saveBinaryFile } from './api';

vi.mock('./api', () => ({ saveBinaryFile: vi.fn(async () => undefined) }));

class RecorderStub {
  static isTypeSupported = () => true;
  state: RecordingState = 'inactive';
  mimeType = 'video/webm';
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(_stream: MediaStream, options?: MediaRecorderOptions) { if (options?.mimeType) this.mimeType = options.mimeType; }
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['video'], { type: this.mimeType }) } as BlobEvent);
    this.onstop?.();
  }
}

function Probe() {
  const sink = useMediaRecorderSink({} as MediaStream, 42);
  return <button onClick={sink.recording ? sink.stop : sink.start}>{sink.recording ? 'stop' : sink.saving ? 'saving' : 'start'}</button>;
}

describe('useMediaRecorderSink', () => {
  beforeEach(() => {
    vi.stubGlobal('MediaRecorder', RecorderStub);
    vi.mocked(saveBinaryFile).mockClear();
  });

  it('records an existing stream and persists the blob through the workspace API', async () => {
    render(<Probe />);
    fireEvent.click(screen.getByText('start'));
    expect(screen.getByText('stop')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByText('stop')); });
    expect(saveBinaryFile).toHaveBeenCalledWith(42, expect.stringMatching(/^recordings\/live-.*\.webm$/), expect.any(Blob));
  });
});
