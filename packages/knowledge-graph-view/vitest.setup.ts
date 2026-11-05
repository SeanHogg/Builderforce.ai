/**
 * Every async read in these tests goes through `findBy*` / `waitFor`, never a fixed sleep. Their
 * default wait is 1 s, which a loaded machine (the whole repo's suites run side by side) can
 * outlast on the idle-scheduled layouts and lazy chunks. One generous ceiling makes the suite
 * deterministic: a passing test still returns the moment its condition holds.
 */
import { configure } from '@testing-library/react';

configure({ asyncUtilTimeout: 15_000 });
