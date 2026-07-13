import '@testing-library/jest-dom';

// Mock next/router
jest.mock('next/router', () => ({
  useRouter: jest.fn(() => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
    back: jest.fn(),
    pathname: '/',
    query: {},
    asPath: '/',
    route: '/',
  })),
  usePathname: jest.fn(() => '/'),
  useSearchParams: jest.fn(() => null),
}));

// Mock next-intl
jest.mock('next-intl', () => ({
  useTranslations: jest.fn(() => {
    const t = (key: string) => key.split('.').pop() || '';
    t.raw = jest.fn(() => ({ en: {}, fr: {} }));
    return {
      t,
      raw: jest.fn(() => ({ en: {}, fr: {} })),
    };
  }),
}));

// Mock Stripe
jest.mock('stripe', () => () => ({
  customers: {
    create: jest.fn(() => ({ id: 'cus_mock' })),
  },
  checkout: {
    sessions: {
      create: jest.fn(() => ({ id: 'cs_mock' })),
    },
  },
  refunds: {
    create: jest.fn(() => ({ id: 'refund_mock' })),
  },
}));

// Suppress console errors during tests
const originalError = console.error;
beforeAll(() => {
  console.error = (...args) => {
    if (
      typeof args[0] === 'string' &&
      (args[0].includes('Warning: ReactDOM.render') ||
       args[0].includes('Warning: Constructor') ||
       args[0].includes('Not implemented: HTMLFormElement.prototype.submit'))
    ) {
      return;
    }
    originalError.call(console, ...args);
  };
});

afterAll(() => {
  console.error = originalError;
});

// Reset mocks after each test
afterEach(() => {
  jest.clearAllMocks();
});