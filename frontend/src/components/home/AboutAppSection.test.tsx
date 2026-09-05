import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Asserts on the REAL English copy, not on keys: the whole point of this band is
// the words it says. Google's OAuth branding review rejected `builderforce.ai`
// for not explaining the app's purpose and for not naming the app on its home
// page, so "a heading rendered" is not the property worth pinning.
vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations')).realCatalogIntlMock(
  (await import('@/i18n/messages/en.json')).default as Record<string, unknown>,
));

const { AboutAppSection } = await import('./AboutAppSection');

describe('AboutAppSection', () => {
  it('names the application, matching the name the OAuth consent screen must carry', () => {
    render(<AboutAppSection />);

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Builderforce.ai');
  });

  it('says what the application is for in plain words', () => {
    const { container } = render(<AboutAppSection />);

    expect(container).toHaveTextContent(/Builderforce\.ai is a web application/);
    expect(container).toHaveTextContent(/turning an idea into a company/);
  });

  it('states that the app is usable without signing in', () => {
    const { container } = render(<AboutAppSection />);

    expect(container).toHaveTextContent(/without an account/i);
    expect(container).toHaveTextContent(/sign in only when/i);
  });

  it('declares which connected-service permissions it asks for, and how they are scoped', () => {
    const { container } = render(<AboutAppSection />);

    expect(container).toHaveTextContent(/Google Drive/);
    expect(container).toHaveTextContent(/Gmail/);
    expect(container).toHaveTextContent(/Google Calendar/);
    expect(container).toHaveTextContent(/revoked at any time/);
  });

  it('links the policies a reviewer looks for', () => {
    render(<AboutAppSection />);

    expect(screen.getByRole('link', { name: 'Privacy policy' })).toHaveAttribute('href', '/legal/privacy');
    expect(screen.getByRole('link', { name: 'Terms of service' })).toHaveAttribute('href', '/legal/terms');
  });
});
