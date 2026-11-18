import { describe, expect, it } from 'vitest';
import { previewPythonOptions, TRAINING_HOST_PROJECT_ID } from './previewPythonOptions';

describe('previewPythonOptions', () => {
  it('loads the torch extension from beside the relay (the Worker’s own origin) and enables training', () => {
    const options = previewPythonOptions('https://preview.builderforce.ai/__bfwc/relay.html');
    expect(options.extensions).toEqual([{ moduleUrl: 'https://preview.builderforce.ai/__bfwc/torch-extension.js', exportName: 'createTorchExtension' }]);
    expect(options.training).toEqual({ projectId: TRAINING_HOST_PROJECT_ID });
  });
});
