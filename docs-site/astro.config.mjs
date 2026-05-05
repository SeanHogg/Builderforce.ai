import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://builderforce.ai',
  base: '/docs',
  trailingSlash: 'never',
  integrations: [
    starlight({
      title: 'Builderforce.ai Docs',
      description:
        'Official Builderforce.ai documentation — covering CoderClaw self-hosted agents, the orchestration portal, channels, tools, models, gateway, CLI, and troubleshooting.',
      logo: {
        src: './src/assets/coderclaw.png',
        alt: 'Builderforce.ai',
        replacesTitle: false,
      },
      favicon: '/favicon-32.png',
      components: {
        SiteTitle: './src/components/SiteTitle.astro',
      },
      head: [
        {
          tag: 'script',
          content: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','GTM-5Q488PKG');`,
        },
        { tag: 'meta', attrs: { property: 'og:type', content: 'website' } },
        {
          tag: 'meta',
          attrs: { property: 'og:image', content: 'https://builderforce.ai/og-image.png' },
        },
        { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
        { tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
        {
          tag: 'meta',
          attrs: { name: 'twitter:image', content: 'https://builderforce.ai/og-image.png' },
        },
      ],
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/SeanHogg/coderClaw' },
        { icon: 'discord', label: 'Discord', href: 'https://discord.gg/9gUsc2sNG6' },
      ],
      customCss: ['./src/styles/custom.css'],
      defaultLocale: 'root',
      locales: {
        root: { label: 'English', lang: 'en' },
        'zh-cn': { label: '中文 (简体)', lang: 'zh-CN' },
        ja: { label: '日本語', lang: 'ja' },
      },
      sidebar: [
        { label: 'Get Started', autogenerate: { directory: 'start' } },
        { label: 'Install', autogenerate: { directory: 'install' } },
        { label: 'Channels', autogenerate: { directory: 'channels' } },
        { label: 'Agents', autogenerate: { directory: 'concepts' } },
        { label: 'Tools', autogenerate: { directory: 'tools' } },
        { label: 'Models', autogenerate: { directory: 'providers' } },
        { label: 'Platforms', autogenerate: { directory: 'platforms' } },
        { label: 'Gateway', autogenerate: { directory: 'gateway' } },
        { label: 'CLI', autogenerate: { directory: 'cli' } },
        { label: 'Orchestration (Builderforce.ai)', autogenerate: { directory: 'link' } },
        { label: 'Reference', autogenerate: { directory: 'reference' } },
        { label: 'Help', autogenerate: { directory: 'help' } },
      ],
      editLink: {
        baseUrl:
          'https://github.com/SeanHogg/Builderforce.ai/edit/main/docs-site/src/content/docs/',
      },
    }),
  ],
});
