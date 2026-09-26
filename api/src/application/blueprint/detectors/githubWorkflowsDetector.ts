/**
 * W2: GitHub Workflows Detector
 * 
 * Detects GitHub Actions workflows for CI/CD.
 */

import type { BlueprintDetector } from '@builderforce/creation-canvas-contract';

export const githubWorkflowsDetector: BlueprintDetector = {
  id: 'github-workflows',
  name: 'GitHub Workflows',
  reads: ['.github/workflows/*.yml', '.github/workflows/*.yaml'],
  detect: (files: Map<string, string>): any => {
    const result: any = {
      sources: { githubWorkflows: false },
    };

    // Check if there are any workflow files
    const hasWorkflows = Array.from(files.keys()).some(key => key.startsWith('.github/workflows/'));

    if (hasWorkflows) {
      result.sources.githubWorkflows = true;

      // Analyze workflow files for hints about the project
      for (const [filename, content] of files.entries()) {
        if (!filename.startsWith('.github/workflows/')) continue;

        // Check for common patterns
        const isNodeWorkflow = content.includes('node') && content.includes('npm');
        const isDeployWorkflow = content.includes('deploy') || content.includes('cloudflare') || content.includes('vercel');
        
        // Could add more analysis here
      }
    }

    return result;
  },
};
