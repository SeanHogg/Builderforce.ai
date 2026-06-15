import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import type { PublishedAgent } from '@/lib/types';
import type { AgentManifest } from '@/lib/builderforceApi';
import { AgentManifestSection, AgentManifestInline, buildAgentManifestText } from './AgentManifestSection';

const agent = (over: Partial<PublishedAgent> = {}): PublishedAgent => ({
  id: 'agent_kevin',
  project_id: null,
  name: 'Kevin BA/PM/PO',
  title: 'Kevin BA/PM/PO',
  bio: 'A BA, Product Owner and Project Manager.',
  skills: [],
  base_model: 'gateway-default',
  status: 'active',
  hire_count: 0,
  created_at: '',
  updated_at: '',
  runtime_support: 'cloud',
  ...over,
});

const manifest = (over: Partial<AgentManifest> = {}): AgentManifest => ({
  skills: [],
  personas: [],
  content: [],
  ...over,
});

describe('buildAgentManifestText', () => {
  it('renders an empty config as em-dashes (the "nothing assigned" signal)', () => {
    const text = buildAgentManifestText(agent(), manifest());
    expect(text).toContain('Ref:     agent_kevin');
    expect(text).toContain('Personas: —');
    expect(text).toContain('Skills:   —');
  });

  it('lists assigned personas and skills with names + slugs', () => {
    const text = buildAgentManifestText(
      agent(),
      manifest({
        personas: [{ slug: 'code-creator', name: 'Code Creator' }],
        skills: [{ slug: 'coding-agent', name: null }],
      }),
    );
    expect(text).toContain('Personas: Code Creator (code-creator)');
    expect(text).toContain('Skills:   coding-agent');
  });
});

describe('AgentManifestSection', () => {
  it('shows the empty note and a Copy manifest button when nothing is assigned', () => {
    const { getByText, getByRole } = render(<AgentManifestSection agent={agent()} manifest={manifest()} />);
    expect(getByText('No skills or personas assigned')).toBeTruthy();
    expect(getByRole('button', { name: 'Copy manifest' })).toBeTruthy();
  });

  it('renders chips for assigned personas/skills', () => {
    const { getByText, queryByText } = render(
      <AgentManifestSection
        agent={agent()}
        manifest={manifest({ personas: [{ slug: 'code-creator', name: 'Code Creator' }], skills: [{ slug: 'github', name: 'GitHub' }] })}
      />,
    );
    expect(getByText('Code Creator')).toBeTruthy();
    expect(getByText('GitHub')).toBeTruthy();
    expect(queryByText('No skills or personas assigned')).toBeNull();
  });
});

describe('AgentManifestInline (list view)', () => {
  it('shows "None assigned" + a Copy button when empty', () => {
    const { getByText, getByRole } = render(<AgentManifestInline agent={agent()} manifest={manifest()} />);
    expect(getByText('None assigned')).toBeTruthy();
    expect(getByRole('button', { name: 'Copy' })).toBeTruthy();
  });

  it('caps the chip strip and shows a +N overflow', () => {
    const { getByText, queryByText } = render(
      <AgentManifestInline
        agent={agent()}
        manifest={manifest({
          personas: [{ slug: 'a', name: 'A' }, { slug: 'b', name: 'B' }],
          skills: [{ slug: 'c', name: 'C' }, { slug: 'd', name: 'D' }, { slug: 'e', name: 'E' }],
        })}
      />,
    );
    // First three (personas first) are shown; the remaining two collapse into +2.
    expect(getByText('A')).toBeTruthy();
    expect(getByText('B')).toBeTruthy();
    expect(getByText('C')).toBeTruthy();
    expect(getByText('+2')).toBeTruthy();
    expect(queryByText('E')).toBeNull();
  });
});
