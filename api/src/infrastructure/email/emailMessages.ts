/**
 * THE server-side message catalog for transactional + lifecycle email.
 *
 * One module, every template, every locale. Templates read from here and NOWHERE
 * else — there is deliberately no per-template locale map, because the moment a
 * second one exists the two drift and a user gets a half-translated mail.
 *
 * `EmailCopy` is an exhaustive interface rather than a loose record, so
 * `Record<EmailLocale, EmailCopy>` makes the compiler the completeness check:
 * adding a string to one locale fails the build until all five have it. That is
 * the whole reason the shape is typed this tightly — a missing key must be a
 * compile error, never a silently-English line in a Chinese email.
 *
 * Interpolation uses the same `{{Name}}` placeholders the HTML templates already
 * use, so a translated string flows through the existing `render()` pass and gets
 * the same HTML escaping. Never pre-interpolate a value into a catalog string.
 *
 * A note on what is NOT here: the scheduled-report SUMMARY table derives its row
 * labels from arbitrary report data keys at runtime (`humanizeKey`), so those
 * cannot be translated ahead of time. The report's CHROME — intro, section
 * titles, known column headers, CTA — is translated below; unknown data keys stay
 * as authored. That boundary is intentional and is the only untranslated text a
 * recipient can see.
 */

import { DEFAULT_EMAIL_LOCALE, type EmailLocale } from './emailLocale';

/** The next-steps plan shared by the welcome and account-type-selected mails. */
export interface NextStepsCopy {
  headline: string;
  steps: { label: string; detail: string }[];
  ctaLabel: string;
}

export interface EmailCopy {
  /** Chrome shared by every template. */
  common: {
    /** Greeting line; `{{RecipientName}}` is substituted by render(). */
    greeting: string;
    /** Greeting for mails sent to an address with no known name (invites, resets). */
    greetingAnonymous: string;
    /** `{{Year}}` is substituted by render(). */
    footerRights: string;
    supportLine: string;
    /** Lifecycle-only footer. `{{UnsubscribeUrl}}` is substituted by render(). */
    unsubscribeLine: string;
    unsubscribeLabel: string;
  };
  magicLink: {
    subject: string;
    intro: string;
    cta: string;
    ignoreNote: string;
  };
  verificationCode: {
    /** `{{Code}}` is substituted by render(). */
    subject: string;
    intro: string;
    expiry: string;
    ignoreNote: string;
  };
  welcome: {
    subject: string;
    intro: string;
    /** Shown when the account's role is not yet known (OAuth signup). */
    roleUnknownBody: string;
    roleUnknownPrompt: string;
    roleUnknownCta: string;
  };
  accountTypeSelected: {
    subjectStandard: string;
    subjectFreelancer: string;
    introStandard: string;
    introFreelancer: string;
  };
  /** Keyed by `users.account_type`. */
  nextSteps: {
    standard: NextStepsCopy;
    freelancer: NextStepsCopy;
  };
  adminReset: {
    subject: string;
    /** `{{Email}}` is substituted by render(). */
    body: string;
    instructions: string;
    cta: string;
    note: string;
  };
  workspaceInvite: {
    /** `{{InviterName}}` / `{{WorkspaceName}}` are substituted by render(). */
    subject: string;
    body: string;
    pitch: string;
    cta: string;
    /** `{{Email}}` / `{{WorkspaceName}}` are substituted by render(). */
    note: string;
  };
  chatInvite: {
    subject: string;
    body: string;
    pitch: string;
    cta: string;
    note: string;
  };
  llmHealth: {
    /** `{{Count}}` is substituted by render(). */
    intro: string;
    runAt: string;
    columnVendor: string;
    columnStatus: string;
    columnModels: string;
    /** `{{Ok}}` / `{{Probed}}` are substituted by render(). */
    okOfProbed: string;
    failedModels: string;
    reviewLine: string;
  };
  report: {
    /** `{{ReportType}}` is substituted by render(). */
    intro: string;
    noData: string;
    cta: string;
    sectionProjects: string;
    sectionPortfolios: string;
    sectionAssignees: string;
    sectionRecentPrs: string;
    sectionInsights: string;
    sectionStalePrs: string;
    /** Known column headers. Data-derived summary keys are not translatable. */
    columns: {
      project: string;
      portfolio: string;
      status: string;
      deploys: string;
      changeFailureRate: string;
      leadTime: string;
      rework: string;
      stuck: string;
      done: string;
      open: string;
      aiSpend: string;
      okrProgress: string;
      blocked: string;
      assignee: string;
      kind: string;
      completed: string;
      title: string;
      repo: string;
      age: string;
    };
  };
  /**
   * Weekly "what's new" digest (LIFECYCLE — product_updates category). Like the
   * report digest, only the CHROME is translated: the release-note titles/bodies
   * are operator-authored marketing data and go out as written.
   */
  releaseDigest: {
    subject: string;
    /** `{{Count}}` is substituted by fill() (server-controlled). */
    intro: string;
    cta: string;
    outro: string;
    /** Badge labels, keyed by `release_notes.category`. */
    categories: {
      new: string;
      improvement: string;
      fix: string;
    };
  };
}

const en: EmailCopy = {
  common: {
    greeting: 'Hi {{RecipientName}},',
    greetingAnonymous: 'Hi,',
    footerRights: '&copy; {{Year}} Builderforce. All rights reserved.',
    supportLine: 'Need a hand getting started? Just reply to this email — a human reads it.',
    unsubscribeLine: 'You are receiving this because you have a Builderforce account.',
    unsubscribeLabel: 'Unsubscribe',
  },
  magicLink: {
    subject: 'Your Builderforce sign-in link',
    intro: 'Click the button below to sign in to your Builderforce account. This link expires in '
      + '<strong>15 minutes</strong> and can only be used once.',
    cta: 'Sign in to Builderforce',
    ignoreNote: 'If you did not request this, you can safely ignore this email — the link will '
      + 'expire on its own.',
  },
  verificationCode: {
    subject: 'Your Builderforce verification code: {{Code}}',
    intro: 'Welcome to Builderforce! Enter this code to confirm your email address and activate '
      + 'your account:',
    expiry: 'This code expires in <strong>15 minutes</strong>.',
    ignoreNote: 'If you did not create a Builderforce account, you can safely ignore this email — '
      + 'no account will be activated without this code.',
  },
  welcome: {
    subject: 'Welcome to Builderforce',
    intro: 'Welcome to Builderforce — your account is live.',
    roleUnknownBody: 'Builderforce gives you an AI workforce that plans, codes, reviews and ships '
      + 'alongside your team — or connects you to teams hiring for that work.',
    roleUnknownPrompt: 'Pick how you want to use it when you sign in, and we will point you at the '
      + 'right first steps.',
    roleUnknownCta: 'Get started',
  },
  accountTypeSelected: {
    subjectStandard: 'Your Builderforce workspace is ready',
    subjectFreelancer: "You're set up to find work on Builderforce",
    introStandard: 'Your account is set up to <strong>Build</strong> — projects, boards and an AI '
      + 'workforce.',
    introFreelancer: 'Your account is set up as a <strong>Hired</strong> profile — for finding work.',
  },
  nextSteps: {
    standard: {
      headline: 'Builderforce gives you an AI workforce that plans, codes, reviews and ships '
        + 'alongside your team. Three things worth doing first:',
      steps: [
        { label: 'Create a project', detail: 'and connect the repository you want worked on.' },
        { label: 'Hire an agent', detail: 'from the workforce, then assign it a ticket on your board.' },
        { label: 'Invite your team', detail: 'so everyone shares the same board, agents and context.' },
      ],
      ctaLabel: 'Open your dashboard',
    },
    freelancer: {
      headline: 'Your account is set up for finding work. Teams search this talent pool by skill '
        + 'and availability, so three things get you in front of them:',
      steps: [
        { label: 'Complete your profile', detail: 'skills, rate and availability — it is what teams match on.' },
        { label: 'Publish it', detail: 'an unpublished profile is private and will not appear in search.' },
        { label: 'Browse open gigs', detail: 'and put yourself forward for the ones that fit.' },
      ],
      ctaLabel: 'Complete your profile',
    },
  },
  adminReset: {
    subject: 'Your Builderforce account access has been reset',
    body: 'An administrator has reset access for your Builderforce account (<strong>{{Email}}</strong>).',
    instructions: 'Click the button below to sign in. Once in, you can update your password from '
      + '<strong>Settings → Account</strong>. This link expires in <strong>24 hours</strong>.',
    cta: 'Sign in to Builderforce',
    note: 'If you did not expect this, contact your administrator or reach out to support.',
  },
  workspaceInvite: {
    subject: '{{InviterName}} invited you to {{WorkspaceName}} on Builderforce',
    body: '<strong>{{InviterName}}</strong> invited you to join the <strong>{{WorkspaceName}}</strong> '
      + 'workspace on Builderforce as a <strong>{{Role}}</strong>.',
    pitch: 'Builderforce.ai is your AI agent workforce — build, train and govern AI agents that ship '
      + 'code, run workflows and connect your systems.',
    cta: 'Accept your invitation',
    note: 'Sign up with this email address ({{Email}}) and you will join {{WorkspaceName}} '
      + 'automatically. If you were not expecting this, you can ignore this email.',
  },
  chatInvite: {
    subject: '{{InviterName}} invited you to a chat on Builderforce',
    body: '<strong>{{InviterName}}</strong> invited you to collaborate on the chat '
      + '<strong>{{ChatTitle}}</strong> in Builderforce.',
    pitch: 'Open Builderforce to join the conversation, share ideas and work together with the team '
      + 'and its AI agents.',
    cta: 'Open the chat',
    note: 'Sign in with this email address ({{Email}}) to join. If you were not expecting this, you '
      + 'can ignore this email.',
  },
  llmHealth: {
    intro: 'The daily LLM vendor health probe detected status changes for {{Count}} vendors.',
    runAt: 'Run at {{Timestamp}}',
    columnVendor: 'Vendor',
    columnStatus: 'Status',
    columnModels: 'Models',
    okOfProbed: '{{Ok}} / {{Probed}} ok',
    failedModels: 'failed models:',
    reviewLine: 'Review the per-model breakdown at',
  },
  report: {
    intro: 'Your scheduled <strong>{{ReportType}}</strong> report is ready.',
    noData: 'No data for this period.',
    cta: 'Open in Builderforce',
    sectionProjects: 'Projects',
    sectionPortfolios: 'Portfolios',
    sectionAssignees: 'By assignee',
    sectionRecentPrs: 'Recent PRs',
    sectionInsights: 'Insights',
    sectionStalePrs: 'Stale PRs',
    columns: {
      project: 'Project',
      portfolio: 'Portfolio',
      status: 'Status',
      deploys: 'Deploys',
      changeFailureRate: 'CFR %',
      leadTime: 'Lead (h)',
      rework: 'Rework %',
      stuck: 'Stuck',
      done: 'Done',
      open: 'Open',
      aiSpend: 'AI $',
      okrProgress: 'OKR %',
      blocked: 'Blocked',
      assignee: 'Assignee',
      kind: 'Kind',
      completed: 'Completed',
      title: 'Title',
      repo: 'Repo',
      age: 'Age (h)',
    },
  },
  releaseDigest: {
    subject: "What's new in Builderforce this week",
    intro: 'Here is what shipped since your last update — {{Count}} things your team can use today.',
    cta: "See what's new",
    outro: 'You are receiving product updates because you have a Builderforce account. '
      + 'Manage which emails you get in Settings → Email.',
    categories: {
      new: 'New',
      improvement: 'Improved',
      fix: 'Fixed',
    },
  },
};

const zh: EmailCopy = {
  common: {
    greeting: '{{RecipientName}}，您好：',
    greetingAnonymous: '您好：',
    footerRights: '&copy; {{Year}} Builderforce。保留所有权利。',
    supportLine: '入门时需要帮助吗？直接回复这封邮件即可——会有真人阅读。',
    unsubscribeLine: '您收到此邮件是因为您拥有 Builderforce 账户。',
    unsubscribeLabel: '退订',
  },
  magicLink: {
    subject: '您的 Builderforce 登录链接',
    intro: '点击下方按钮登录您的 Builderforce 账户。该链接将在 <strong>15 分钟</strong>后失效，且只能使用一次。',
    cta: '登录 Builderforce',
    ignoreNote: '如果这不是您本人的操作，可以放心忽略这封邮件——链接会自动失效。',
  },
  verificationCode: {
    subject: '您的 Builderforce 验证码：{{Code}}',
    intro: '欢迎使用 Builderforce！请输入以下验证码以确认您的邮箱地址并激活账户：',
    expiry: '该验证码将在 <strong>15 分钟</strong>后失效。',
    ignoreNote: '如果您没有注册过 Builderforce 账户，可以放心忽略这封邮件——没有此验证码不会激活任何账户。',
  },
  welcome: {
    subject: '欢迎加入 Builderforce',
    intro: '欢迎使用 Builderforce——您的账户已开通。',
    roleUnknownBody: 'Builderforce 为您提供一支 AI 团队，与您的团队并肩规划、编码、评审并交付——'
      + '也可以帮您对接正在招聘这类工作的团队。',
    roleUnknownPrompt: '登录后选择您的使用方式，我们会为您指出合适的第一步。',
    roleUnknownCta: '立即开始',
  },
  accountTypeSelected: {
    subjectStandard: '您的 Builderforce 工作区已就绪',
    subjectFreelancer: '您已设置为在 Builderforce 上寻找工作',
    introStandard: '您的账户已设置为<strong>构建</strong>模式——包含项目、看板和 AI 团队。',
    introFreelancer: '您的账户已设置为<strong>受雇</strong>档案——用于寻找工作机会。',
  },
  nextSteps: {
    standard: {
      headline: 'Builderforce 为您提供一支 AI 团队，与您的团队并肩规划、编码、评审并交付。'
        + '建议先做这三件事：',
      steps: [
        { label: '创建项目', detail: '并关联您希望处理的代码仓库。' },
        { label: '雇佣智能体', detail: '从团队中选择，然后在看板上为它分配工单。' },
        { label: '邀请团队成员', detail: '让所有人共享同一个看板、智能体和上下文。' },
      ],
      ctaLabel: '打开控制台',
    },
    freelancer: {
      headline: '您的账户已设置为寻找工作。各团队会按技能和可用时间在人才库中搜索，'
        + '因此这三件事能让您脱颖而出：',
      steps: [
        { label: '完善个人档案', detail: '技能、费率和可用时间——这正是团队匹配的依据。' },
        { label: '发布档案', detail: '未发布的档案为私密状态，不会出现在搜索结果中。' },
        { label: '浏览开放职位', detail: '并为合适的机会主动申请。' },
      ],
      ctaLabel: '完善个人档案',
    },
  },
  adminReset: {
    subject: '您的 Builderforce 账户访问权限已重置',
    body: '管理员已重置您的 Builderforce 账户（<strong>{{Email}}</strong>）的访问权限。',
    instructions: '点击下方按钮登录。登录后，您可以在<strong>设置 → 账户</strong>中修改密码。'
      + '该链接将在 <strong>24 小时</strong>后失效。',
    cta: '登录 Builderforce',
    note: '如果这不在您的预期之内，请联系您的管理员或与支持团队取得联系。',
  },
  workspaceInvite: {
    subject: '{{InviterName}} 邀请您加入 Builderforce 上的 {{WorkspaceName}}',
    body: '<strong>{{InviterName}}</strong> 邀请您以<strong>{{Role}}</strong>的身份加入 Builderforce 上的'
      + '<strong>{{WorkspaceName}}</strong> 工作区。',
    pitch: 'Builderforce.ai 是您的 AI 智能体团队——构建、训练并治理能够交付代码、运行工作流并连接系统的 AI 智能体。',
    cta: '接受邀请',
    note: '使用此邮箱地址（{{Email}}）注册，您将自动加入 {{WorkspaceName}}。'
      + '如果这不在您的预期之内，可以忽略这封邮件。',
  },
  chatInvite: {
    subject: '{{InviterName}} 邀请您参与 Builderforce 上的一场对话',
    body: '<strong>{{InviterName}}</strong> 邀请您协作参与 Builderforce 中的对话'
      + '<strong>{{ChatTitle}}</strong>。',
    pitch: '打开 Builderforce 即可加入讨论、分享想法，并与团队及其 AI 智能体协同工作。',
    cta: '打开对话',
    note: '使用此邮箱地址（{{Email}}）登录即可加入。如果这不在您的预期之内，可以忽略这封邮件。',
  },
  llmHealth: {
    intro: '每日 LLM 供应商健康探测检测到 {{Count}} 家供应商的状态发生变化。',
    runAt: '运行时间：{{Timestamp}}',
    columnVendor: '供应商',
    columnStatus: '状态',
    columnModels: '模型',
    okOfProbed: '{{Ok}} / {{Probed}} 正常',
    failedModels: '失败的模型：',
    reviewLine: '查看各模型的详细情况：',
  },
  report: {
    intro: '您的定期<strong>{{ReportType}}</strong>报告已生成。',
    noData: '本期没有数据。',
    cta: '在 Builderforce 中打开',
    sectionProjects: '项目',
    sectionPortfolios: '项目组合',
    sectionAssignees: '按负责人',
    sectionRecentPrs: '最近的 PR',
    sectionInsights: '洞察',
    sectionStalePrs: '停滞的 PR',
    columns: {
      project: '项目',
      portfolio: '项目组合',
      status: '状态',
      deploys: '部署次数',
      changeFailureRate: '变更失败率 %',
      leadTime: '前置时间（小时）',
      rework: '返工率 %',
      stuck: '停滞',
      done: '已完成',
      open: '进行中',
      aiSpend: 'AI 支出（美元）',
      okrProgress: 'OKR 进度 %',
      blocked: '受阻',
      assignee: '负责人',
      kind: '类型',
      completed: '已完成',
      title: '标题',
      repo: '仓库',
      age: '存在时长（小时）',
    },
  },
  releaseDigest: {
    subject: 'Builderforce 本周新功能',
    intro: '以下是自上次更新以来发布的内容——{{Count}} 项您的团队今天就能使用的新功能。',
    cta: '查看新功能',
    outro: '您收到产品更新邮件是因为您拥有 Builderforce 账户。可在“设置 → 邮件”中管理您接收的邮件。',
    categories: {
      new: '新功能',
      improvement: '改进',
      fix: '修复',
    },
  },
};

const es: EmailCopy = {
  common: {
    greeting: 'Hola {{RecipientName}}:',
    greetingAnonymous: 'Hola:',
    footerRights: '&copy; {{Year}} Builderforce. Todos los derechos reservados.',
    supportLine: '¿Necesitas ayuda para empezar? Responde a este correo — lo lee una persona.',
    unsubscribeLine: 'Recibes este mensaje porque tienes una cuenta de Builderforce.',
    unsubscribeLabel: 'Darse de baja',
  },
  magicLink: {
    subject: 'Tu enlace de acceso a Builderforce',
    intro: 'Haz clic en el botón para iniciar sesión en tu cuenta de Builderforce. Este enlace '
      + 'caduca en <strong>15 minutos</strong> y solo puede usarse una vez.',
    cta: 'Iniciar sesión en Builderforce',
    ignoreNote: 'Si no has solicitado esto, puedes ignorar este correo sin problema — el enlace '
      + 'caducará por sí solo.',
  },
  verificationCode: {
    subject: 'Tu código de verificación de Builderforce: {{Code}}',
    intro: '¡Te damos la bienvenida a Builderforce! Introduce este código para confirmar tu '
      + 'dirección de correo y activar tu cuenta:',
    expiry: 'Este código caduca en <strong>15 minutos</strong>.',
    ignoreNote: 'Si no has creado una cuenta de Builderforce, puedes ignorar este correo sin '
      + 'problema — no se activará ninguna cuenta sin este código.',
  },
  welcome: {
    subject: 'Te damos la bienvenida a Builderforce',
    intro: 'Te damos la bienvenida a Builderforce: tu cuenta ya está activa.',
    roleUnknownBody: 'Builderforce te da una plantilla de IA que planifica, programa, revisa y '
      + 'entrega junto a tu equipo, o te conecta con equipos que contratan para ese trabajo.',
    roleUnknownPrompt: 'Elige cómo quieres usarlo al iniciar sesión y te indicaremos los primeros '
      + 'pasos adecuados.',
    roleUnknownCta: 'Empezar',
  },
  accountTypeSelected: {
    subjectStandard: 'Tu espacio de trabajo de Builderforce está listo',
    subjectFreelancer: 'Ya puedes buscar trabajo en Builderforce',
    introStandard: 'Tu cuenta está configurada para <strong>Construir</strong>: proyectos, tableros '
      + 'y una plantilla de IA.',
    introFreelancer: 'Tu cuenta está configurada como perfil <strong>Contratado</strong>, para '
      + 'buscar trabajo.',
  },
  nextSteps: {
    standard: {
      headline: 'Builderforce te da una plantilla de IA que planifica, programa, revisa y entrega '
        + 'junto a tu equipo. Tres cosas que conviene hacer primero:',
      steps: [
        { label: 'Crea un proyecto', detail: 'y conecta el repositorio en el que quieres trabajar.' },
        { label: 'Contrata un agente', detail: 'de la plantilla y asígnale un ticket en tu tablero.' },
        { label: 'Invita a tu equipo', detail: 'para que todos compartan el mismo tablero, agentes y contexto.' },
      ],
      ctaLabel: 'Abrir tu panel',
    },
    freelancer: {
      headline: 'Tu cuenta está configurada para buscar trabajo. Los equipos buscan en esta bolsa '
        + 'de talento por habilidades y disponibilidad, así que tres cosas te ponen delante de ellos:',
      steps: [
        { label: 'Completa tu perfil', detail: 'habilidades, tarifa y disponibilidad: es lo que los equipos comparan.' },
        { label: 'Publícalo', detail: 'un perfil sin publicar es privado y no aparecerá en las búsquedas.' },
        { label: 'Explora los encargos abiertos', detail: 'y preséntate a los que encajen contigo.' },
      ],
      ctaLabel: 'Completar tu perfil',
    },
  },
  adminReset: {
    subject: 'Se ha restablecido el acceso a tu cuenta de Builderforce',
    body: 'Un administrador ha restablecido el acceso a tu cuenta de Builderforce '
      + '(<strong>{{Email}}</strong>).',
    instructions: 'Haz clic en el botón para iniciar sesión. Una vez dentro, puedes cambiar tu '
      + 'contraseña en <strong>Ajustes → Cuenta</strong>. Este enlace caduca en <strong>24 horas</strong>.',
    cta: 'Iniciar sesión en Builderforce',
    note: 'Si no esperabas esto, ponte en contacto con tu administrador o escribe a soporte.',
  },
  workspaceInvite: {
    subject: '{{InviterName}} te ha invitado a {{WorkspaceName}} en Builderforce',
    body: '<strong>{{InviterName}}</strong> te ha invitado a unirte al espacio de trabajo '
      + '<strong>{{WorkspaceName}}</strong> en Builderforce como <strong>{{Role}}</strong>.',
    pitch: 'Builderforce.ai es tu plantilla de agentes de IA: crea, entrena y gobierna agentes que '
      + 'entregan código, ejecutan flujos de trabajo y conectan tus sistemas.',
    cta: 'Aceptar la invitación',
    note: 'Regístrate con esta dirección de correo ({{Email}}) y te unirás a {{WorkspaceName}} '
      + 'automáticamente. Si no esperabas esto, puedes ignorar este correo.',
  },
  chatInvite: {
    subject: '{{InviterName}} te ha invitado a un chat en Builderforce',
    body: '<strong>{{InviterName}}</strong> te ha invitado a colaborar en el chat '
      + '<strong>{{ChatTitle}}</strong> de Builderforce.',
    pitch: 'Abre Builderforce para unirte a la conversación, compartir ideas y trabajar junto al '
      + 'equipo y sus agentes de IA.',
    cta: 'Abrir el chat',
    note: 'Inicia sesión con esta dirección de correo ({{Email}}) para unirte. Si no esperabas '
      + 'esto, puedes ignorar este correo.',
  },
  llmHealth: {
    intro: 'La sonda diaria de estado de proveedores LLM ha detectado cambios en {{Count}} proveedores.',
    runAt: 'Ejecutado a las {{Timestamp}}',
    columnVendor: 'Proveedor',
    columnStatus: 'Estado',
    columnModels: 'Modelos',
    okOfProbed: '{{Ok}} / {{Probed}} correctos',
    failedModels: 'modelos fallidos:',
    reviewLine: 'Consulta el desglose por modelo en',
  },
  report: {
    intro: 'Tu informe programado de <strong>{{ReportType}}</strong> está listo.',
    noData: 'No hay datos para este periodo.',
    cta: 'Abrir en Builderforce',
    sectionProjects: 'Proyectos',
    sectionPortfolios: 'Carteras',
    sectionAssignees: 'Por responsable',
    sectionRecentPrs: 'PR recientes',
    sectionInsights: 'Conclusiones',
    sectionStalePrs: 'PR estancados',
    columns: {
      project: 'Proyecto',
      portfolio: 'Cartera',
      status: 'Estado',
      deploys: 'Despliegues',
      changeFailureRate: '% fallos de cambio',
      leadTime: 'Entrega (h)',
      rework: '% retrabajo',
      stuck: 'Atascados',
      done: 'Hechos',
      open: 'Abiertos',
      aiSpend: 'Gasto IA ($)',
      okrProgress: '% OKR',
      blocked: 'Bloqueados',
      assignee: 'Responsable',
      kind: 'Tipo',
      completed: 'Completados',
      title: 'Título',
      repo: 'Repositorio',
      age: 'Antigüedad (h)',
    },
  },
  releaseDigest: {
    subject: 'Novedades de Builderforce esta semana',
    intro: 'Esto es lo que hemos lanzado desde tu última actualización: {{Count}} novedades que tu equipo puede usar hoy.',
    cta: 'Ver las novedades',
    outro: 'Recibes actualizaciones de producto porque tienes una cuenta de Builderforce. '
      + 'Gestiona qué correos recibes en Configuración → Correo.',
    categories: {
      new: 'Nuevo',
      improvement: 'Mejorado',
      fix: 'Corregido',
    },
  },
};

const fr: EmailCopy = {
  common: {
    greeting: 'Bonjour {{RecipientName}},',
    greetingAnonymous: 'Bonjour,',
    footerRights: '&copy; {{Year}} Builderforce. Tous droits réservés.',
    supportLine: 'Besoin d’aide pour démarrer ? Répondez simplement à cet e-mail — un humain le lit.',
    unsubscribeLine: 'Vous recevez ce message parce que vous avez un compte Builderforce.',
    unsubscribeLabel: 'Se désabonner',
  },
  magicLink: {
    subject: 'Votre lien de connexion Builderforce',
    intro: 'Cliquez sur le bouton ci-dessous pour vous connecter à votre compte Builderforce. Ce '
      + 'lien expire dans <strong>15 minutes</strong> et ne peut être utilisé qu’une seule fois.',
    cta: 'Se connecter à Builderforce',
    ignoreNote: 'Si vous n’êtes pas à l’origine de cette demande, vous pouvez ignorer cet '
      + 'e-mail sans risque — le lien expirera de lui-même.',
  },
  verificationCode: {
    subject: 'Votre code de vérification Builderforce : {{Code}}',
    intro: 'Bienvenue sur Builderforce ! Saisissez ce code pour confirmer votre adresse e-mail et '
      + 'activer votre compte :',
    expiry: 'Ce code expire dans <strong>15 minutes</strong>.',
    ignoreNote: 'Si vous n’avez pas créé de compte Builderforce, vous pouvez ignorer cet e-mail '
      + 'sans risque — aucun compte ne sera activé sans ce code.',
  },
  welcome: {
    subject: 'Bienvenue sur Builderforce',
    intro: 'Bienvenue sur Builderforce — votre compte est actif.',
    roleUnknownBody: 'Builderforce vous donne une équipe d’IA qui planifie, code, relit et livre '
      + 'aux côtés de votre équipe — ou vous met en relation avec des équipes qui recrutent pour ce travail.',
    roleUnknownPrompt: 'Choisissez comment vous souhaitez l’utiliser lors de votre connexion et '
      + 'nous vous indiquerons les premières étapes adaptées.',
    roleUnknownCta: 'Commencer',
  },
  accountTypeSelected: {
    subjectStandard: 'Votre espace de travail Builderforce est prêt',
    subjectFreelancer: 'Vous êtes prêt à trouver des missions sur Builderforce',
    introStandard: 'Votre compte est configuré pour <strong>Construire</strong> — projets, tableaux '
      + 'et une équipe d’IA.',
    introFreelancer: 'Votre compte est configuré en profil <strong>Recruté</strong> — pour trouver '
      + 'des missions.',
  },
  nextSteps: {
    standard: {
      headline: 'Builderforce vous donne une équipe d’IA qui planifie, code, relit et livre aux '
        + 'côtés de votre équipe. Trois choses à faire en priorité :',
      steps: [
        { label: 'Créez un projet', detail: 'et connectez le dépôt sur lequel vous voulez travailler.' },
        { label: 'Recrutez un agent', detail: 'dans l’équipe, puis attribuez-lui un ticket sur votre tableau.' },
        { label: 'Invitez votre équipe', detail: 'pour que tout le monde partage le même tableau, les mêmes agents et le même contexte.' },
      ],
      ctaLabel: 'Ouvrir votre tableau de bord',
    },
    freelancer: {
      headline: 'Votre compte est configuré pour trouver des missions. Les équipes parcourent ce '
        + 'vivier de talents par compétence et disponibilité : trois choses vous mettent en avant.',
      steps: [
        { label: 'Complétez votre profil', detail: 'compétences, tarif et disponibilité — c’est ce sur quoi les équipes se basent.' },
        { label: 'Publiez-le', detail: 'un profil non publié reste privé et n’apparaîtra pas dans les recherches.' },
        { label: 'Parcourez les missions ouvertes', detail: 'et proposez-vous pour celles qui vous correspondent.' },
      ],
      ctaLabel: 'Compléter votre profil',
    },
  },
  adminReset: {
    subject: 'L’accès à votre compte Builderforce a été réinitialisé',
    body: 'Un administrateur a réinitialisé l’accès à votre compte Builderforce '
      + '(<strong>{{Email}}</strong>).',
    instructions: 'Cliquez sur le bouton ci-dessous pour vous connecter. Une fois connecté, vous '
      + 'pouvez modifier votre mot de passe depuis <strong>Paramètres → Compte</strong>. Ce lien '
      + 'expire dans <strong>24 heures</strong>.',
    cta: 'Se connecter à Builderforce',
    note: 'Si vous ne vous y attendiez pas, contactez votre administrateur ou le support.',
  },
  workspaceInvite: {
    subject: '{{InviterName}} vous a invité à rejoindre {{WorkspaceName}} sur Builderforce',
    body: '<strong>{{InviterName}}</strong> vous a invité à rejoindre l’espace de travail '
      + '<strong>{{WorkspaceName}}</strong> sur Builderforce en tant que <strong>{{Role}}</strong>.',
    pitch: 'Builderforce.ai est votre équipe d’agents IA — créez, entraînez et gouvernez des '
      + 'agents qui livrent du code, exécutent des workflows et connectent vos systèmes.',
    cta: 'Accepter l’invitation',
    note: 'Inscrivez-vous avec cette adresse e-mail ({{Email}}) et vous rejoindrez '
      + '{{WorkspaceName}} automatiquement. Si vous ne vous y attendiez pas, ignorez cet e-mail.',
  },
  chatInvite: {
    subject: '{{InviterName}} vous a invité à une conversation sur Builderforce',
    body: '<strong>{{InviterName}}</strong> vous a invité à collaborer sur la conversation '
      + '<strong>{{ChatTitle}}</strong> dans Builderforce.',
    pitch: 'Ouvrez Builderforce pour rejoindre la conversation, partager vos idées et travailler '
      + 'avec l’équipe et ses agents IA.',
    cta: 'Ouvrir la conversation',
    note: 'Connectez-vous avec cette adresse e-mail ({{Email}}) pour participer. Si vous ne vous y '
      + 'attendiez pas, vous pouvez ignorer cet e-mail.',
  },
  llmHealth: {
    intro: 'La sonde quotidienne de santé des fournisseurs LLM a détecté des changements de statut '
      + 'pour {{Count}} fournisseurs.',
    runAt: 'Exécutée à {{Timestamp}}',
    columnVendor: 'Fournisseur',
    columnStatus: 'Statut',
    columnModels: 'Modèles',
    okOfProbed: '{{Ok}} / {{Probed}} OK',
    failedModels: 'modèles en échec :',
    reviewLine: 'Consultez le détail par modèle sur',
  },
  report: {
    intro: 'Votre rapport programmé <strong>{{ReportType}}</strong> est prêt.',
    noData: 'Aucune donnée pour cette période.',
    cta: 'Ouvrir dans Builderforce',
    sectionProjects: 'Projets',
    sectionPortfolios: 'Portefeuilles',
    sectionAssignees: 'Par responsable',
    sectionRecentPrs: 'PR récentes',
    sectionInsights: 'Enseignements',
    sectionStalePrs: 'PR en attente',
    columns: {
      project: 'Projet',
      portfolio: 'Portefeuille',
      status: 'Statut',
      deploys: 'Déploiements',
      changeFailureRate: '% d’échecs',
      leadTime: 'Délai (h)',
      rework: '% reprise',
      stuck: 'Bloqués',
      done: 'Terminés',
      open: 'Ouverts',
      aiSpend: 'Coût IA ($)',
      okrProgress: '% OKR',
      blocked: 'Bloqués',
      assignee: 'Responsable',
      kind: 'Type',
      completed: 'Terminés',
      title: 'Titre',
      repo: 'Dépôt',
      age: 'Ancienneté (h)',
    },
  },
  releaseDigest: {
    subject: 'Les nouveautés Builderforce de la semaine',
    intro: 'Voici ce qui a été livré depuis votre dernière mise à jour : {{Count}} nouveautés que votre équipe peut utiliser dès aujourd’hui.',
    cta: 'Découvrir les nouveautés',
    outro: 'Vous recevez les actualités produit car vous avez un compte Builderforce. '
      + 'Gérez vos e-mails dans Paramètres → E-mail.',
    categories: {
      new: 'Nouveau',
      improvement: 'Amélioré',
      fix: 'Corrigé',
    },
  },
};

const de: EmailCopy = {
  common: {
    greeting: 'Hallo {{RecipientName}},',
    greetingAnonymous: 'Hallo,',
    footerRights: '&copy; {{Year}} Builderforce. Alle Rechte vorbehalten.',
    supportLine: 'Brauchen Sie Hilfe beim Einstieg? Antworten Sie einfach auf diese E-Mail — ein '
      + 'Mensch liest mit.',
    unsubscribeLine: 'Sie erhalten diese Nachricht, weil Sie ein Builderforce-Konto haben.',
    unsubscribeLabel: 'Abmelden',
  },
  magicLink: {
    subject: 'Ihr Builderforce-Anmeldelink',
    intro: 'Klicken Sie auf die Schaltfläche unten, um sich bei Ihrem Builderforce-Konto anzumelden. '
      + 'Dieser Link läuft in <strong>15 Minuten</strong> ab und kann nur einmal verwendet werden.',
    cta: 'Bei Builderforce anmelden',
    ignoreNote: 'Wenn Sie das nicht angefordert haben, können Sie diese E-Mail bedenkenlos '
      + 'ignorieren — der Link läuft von selbst ab.',
  },
  verificationCode: {
    subject: 'Ihr Builderforce-Bestätigungscode: {{Code}}',
    intro: 'Willkommen bei Builderforce! Geben Sie diesen Code ein, um Ihre E-Mail-Adresse zu '
      + 'bestätigen und Ihr Konto zu aktivieren:',
    expiry: 'Dieser Code läuft in <strong>15 Minuten</strong> ab.',
    ignoreNote: 'Wenn Sie kein Builderforce-Konto erstellt haben, können Sie diese E-Mail '
      + 'bedenkenlos ignorieren — ohne diesen Code wird kein Konto aktiviert.',
  },
  welcome: {
    subject: 'Willkommen bei Builderforce',
    intro: 'Willkommen bei Builderforce — Ihr Konto ist aktiv.',
    roleUnknownBody: 'Builderforce gibt Ihnen eine KI-Belegschaft, die gemeinsam mit Ihrem Team '
      + 'plant, programmiert, prüft und ausliefert — oder vermittelt Sie an Teams, die genau dafür '
      + 'Personal suchen.',
    roleUnknownPrompt: 'Wählen Sie bei der Anmeldung, wie Sie es nutzen möchten, und wir zeigen '
      + 'Ihnen die passenden ersten Schritte.',
    roleUnknownCta: 'Loslegen',
  },
  accountTypeSelected: {
    subjectStandard: 'Ihr Builderforce-Arbeitsbereich ist bereit',
    subjectFreelancer: 'Sie sind bereit, auf Builderforce Aufträge zu finden',
    introStandard: 'Ihr Konto ist zum <strong>Bauen</strong> eingerichtet — Projekte, Boards und '
      + 'eine KI-Belegschaft.',
    introFreelancer: 'Ihr Konto ist als <strong>Engagiert</strong>-Profil eingerichtet — für die '
      + 'Auftragssuche.',
  },
  nextSteps: {
    standard: {
      headline: 'Builderforce gibt Ihnen eine KI-Belegschaft, die gemeinsam mit Ihrem Team plant, '
        + 'programmiert, prüft und ausliefert. Drei Dinge lohnen sich zuerst:',
      steps: [
        { label: 'Projekt anlegen', detail: 'und das Repository verbinden, an dem gearbeitet werden soll.' },
        { label: 'Agenten einstellen', detail: 'aus der Belegschaft und ihm ein Ticket auf Ihrem Board zuweisen.' },
        { label: 'Team einladen', detail: 'damit alle dasselbe Board, dieselben Agenten und denselben Kontext teilen.' },
      ],
      ctaLabel: 'Dashboard öffnen',
    },
    freelancer: {
      headline: 'Ihr Konto ist auf die Auftragssuche ausgerichtet. Teams durchsuchen diesen '
        + 'Talentpool nach Fähigkeiten und Verfügbarkeit — drei Dinge bringen Sie vor deren Augen:',
      steps: [
        { label: 'Profil vervollständigen', detail: 'Fähigkeiten, Honorar und Verfügbarkeit — genau danach suchen Teams.' },
        { label: 'Profil veröffentlichen', detail: 'ein unveröffentlichtes Profil ist privat und erscheint nicht in der Suche.' },
        { label: 'Offene Aufträge ansehen', detail: 'und sich auf die passenden bewerben.' },
      ],
      ctaLabel: 'Profil vervollständigen',
    },
  },
  adminReset: {
    subject: 'Der Zugang zu Ihrem Builderforce-Konto wurde zurückgesetzt',
    body: 'Ein Administrator hat den Zugang zu Ihrem Builderforce-Konto '
      + '(<strong>{{Email}}</strong>) zurückgesetzt.',
    instructions: 'Klicken Sie auf die Schaltfläche unten, um sich anzumelden. Danach können Sie Ihr '
      + 'Passwort unter <strong>Einstellungen → Konto</strong> ändern. Dieser Link läuft in '
      + '<strong>24 Stunden</strong> ab.',
    cta: 'Bei Builderforce anmelden',
    note: 'Wenn Sie das nicht erwartet haben, wenden Sie sich an Ihren Administrator oder an den Support.',
  },
  workspaceInvite: {
    subject: '{{InviterName}} hat Sie zu {{WorkspaceName}} auf Builderforce eingeladen',
    body: '<strong>{{InviterName}}</strong> hat Sie eingeladen, dem Arbeitsbereich '
      + '<strong>{{WorkspaceName}}</strong> auf Builderforce als <strong>{{Role}}</strong> beizutreten.',
    pitch: 'Builderforce.ai ist Ihre KI-Agenten-Belegschaft — bauen, trainieren und steuern Sie '
      + 'KI-Agenten, die Code ausliefern, Workflows ausführen und Ihre Systeme verbinden.',
    cta: 'Einladung annehmen',
    note: 'Registrieren Sie sich mit dieser E-Mail-Adresse ({{Email}}) und Sie treten '
      + '{{WorkspaceName}} automatisch bei. Wenn Sie das nicht erwartet haben, ignorieren Sie diese E-Mail.',
  },
  chatInvite: {
    subject: '{{InviterName}} hat Sie zu einem Chat auf Builderforce eingeladen',
    body: '<strong>{{InviterName}}</strong> hat Sie eingeladen, im Chat '
      + '<strong>{{ChatTitle}}</strong> in Builderforce mitzuarbeiten.',
    pitch: 'Öffnen Sie Builderforce, um der Unterhaltung beizutreten, Ideen zu teilen und mit dem '
      + 'Team und seinen KI-Agenten zusammenzuarbeiten.',
    cta: 'Chat öffnen',
    note: 'Melden Sie sich mit dieser E-Mail-Adresse ({{Email}}) an, um teilzunehmen. Wenn Sie das '
      + 'nicht erwartet haben, können Sie diese E-Mail ignorieren.',
  },
  llmHealth: {
    intro: 'Die tägliche LLM-Anbieter-Statusprüfung hat Statusänderungen bei {{Count}} Anbietern '
      + 'festgestellt.',
    runAt: 'Ausgeführt um {{Timestamp}}',
    columnVendor: 'Anbieter',
    columnStatus: 'Status',
    columnModels: 'Modelle',
    okOfProbed: '{{Ok}} / {{Probed}} OK',
    failedModels: 'fehlgeschlagene Modelle:',
    reviewLine: 'Die Aufschlüsselung je Modell finden Sie unter',
  },
  report: {
    intro: 'Ihr geplanter <strong>{{ReportType}}</strong>-Bericht ist fertig.',
    noData: 'Keine Daten für diesen Zeitraum.',
    cta: 'In Builderforce öffnen',
    sectionProjects: 'Projekte',
    sectionPortfolios: 'Portfolios',
    sectionAssignees: 'Nach Zuständigem',
    sectionRecentPrs: 'Aktuelle PRs',
    sectionInsights: 'Erkenntnisse',
    sectionStalePrs: 'Liegengebliebene PRs',
    columns: {
      project: 'Projekt',
      portfolio: 'Portfolio',
      status: 'Status',
      deploys: 'Deployments',
      changeFailureRate: 'Fehlerrate %',
      leadTime: 'Durchlaufzeit (Std.)',
      rework: 'Nacharbeit %',
      stuck: 'Steckengeblieben',
      done: 'Erledigt',
      open: 'Offen',
      aiSpend: 'KI-Kosten ($)',
      okrProgress: 'OKR %',
      blocked: 'Blockiert',
      assignee: 'Zuständig',
      kind: 'Art',
      completed: 'Abgeschlossen',
      title: 'Titel',
      repo: 'Repository',
      age: 'Alter (Std.)',
    },
  },
  releaseDigest: {
    subject: 'Neu bei Builderforce diese Woche',
    intro: 'Das ist seit Ihrem letzten Update erschienen — {{Count}} Neuerungen, die Ihr Team heute nutzen kann.',
    cta: 'Neuerungen ansehen',
    outro: 'Sie erhalten Produkt-Updates, weil Sie ein Builderforce-Konto haben. '
      + 'Verwalten Sie Ihre E-Mails unter Einstellungen → E-Mail.',
    categories: {
      new: 'Neu',
      improvement: 'Verbessert',
      fix: 'Behoben',
    },
  },
};

/**
 * The catalog. Typed as `Record<EmailLocale, EmailCopy>` on purpose: this is the
 * declaration that makes an untranslated string a build failure.
 */
export const EMAIL_MESSAGES: Record<EmailLocale, EmailCopy> = { en, zh, es, fr, de };

/**
 * The ONE accessor every template uses. Falls back to English for a locale that
 * somehow escaped narrowing (defensive — `EmailLocale` should make it impossible),
 * so a bad locale can degrade to English but never render `undefined` into a mail.
 */
export function emailCopy(locale: EmailLocale): EmailCopy {
  return EMAIL_MESSAGES[locale] ?? EMAIL_MESSAGES[DEFAULT_EMAIL_LOCALE];
}
