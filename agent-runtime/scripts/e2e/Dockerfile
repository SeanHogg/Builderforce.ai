FROM node:24-bookworm

RUN corepack enable

WORKDIR /app

ENV NODE_OPTIONS="--disable-warning=ExperimentalWarning"

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.plugin-sdk.dts.json tsdown.config.ts vitest.config.ts vitest.e2e.config.ts builderforce.mjs ./
COPY src ./src
COPY test ./test
COPY scripts ./scripts
COPY docs ./docs
COPY skills ./skills
COPY patches ./patches
COPY ui ./ui
COPY extensions/memory-core ./extensions/memory-core
COPY vendor/a2ui/renderers/lit ./vendor/a2ui/renderers/lit
# The Canvas A2UI app sources live at the monorepo root
# (apps/shared/BuilderforceKit/Tools/CanvasA2UI), outside this build context, so
# skip the bundle exactly like the main Dockerfile does.
ENV BUILDERFORCE_AGENTS_A2UI_SKIP_MISSING=1

RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN pnpm ui:build

CMD ["bash"]
