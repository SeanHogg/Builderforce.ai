// The selling half of /embedded (<EmbeddedStackValue>) — the stack-value case, the
// three pillars, and the build → embed → sell loop that ties an embedded capability
// to the Marketplace. Plus the two catalog strings the pitch needs: the visitor-facing
// hero metric and the per-card "replaces" line.
//
// Product names (Intercom, Hotjar, …) are NOT here on purpose: they are brand data on
// EMBEDDED_CAPABILITIES, and a brand name is the same in five languages.
//
// Usage: node scripts/i18n-merge.mjs scripts/i18n-patch-embedded-sell.mjs
export const PATCHES = {
  en: {
    embedded: {
      availableCapabilities: 'capabilities you can embed',
      replaces: 'Replaces {tools}',
      sell: {
        label: 'Why embedded capabilities',
        title: 'One script instead of thirteen contracts',
        description:
          'Everything you build in BuilderForce can run inside your own product — support, feedback, analytics, flags, consent, status. Each capability is governed on its own, and all of them arrive through a single tag you install once.',
        stats: {
          capabilities: 'capabilities in one tag',
          script: 'script to install',
          stack: 'per month of point tools it stands in for',
          yearly: 'a year of tooling off the roadmap',
        },
        replacesLabel: 'Stands in for tools like',
        benchmarkNote:
          'Comparison figures are published entry-tier list prices for comparable point tools at small-team volume. They are an anchor, not a quote — your own costs and usage will differ.',
        pillars: {
          install: {
            title: 'Install once, change your mind later',
            body: 'One tag goes on your site. Turning a capability on or off happens in your workspace and applies on the next page load — no redeploy, no second vendor to onboard, no new script to review.',
          },
          govern: {
            title: 'Consent is built in, not bolted on',
            body: 'Every capability is opted into individually, against a versioned consent text, and each opt-in and opt-out is written to an immutable workspace log you can hand to an auditor.',
          },
          own: {
            title: 'It stays yours',
            body: 'The data belongs to your workspace, the experience carries your brand, and the capability is the thing you designed in Canvas — not a third-party widget wearing your colours.',
          },
        },
        loop: {
          title: 'From idea to embedded to sold',
          description:
            'Our job is to help you sell what you build, so the same path runs end to end: design the experience, put it in front of your customers, then list it for everyone else.',
          steps: {
            build: {
              title: 'Build it in Canvas',
              body: 'Describe the experience you want and shape it on the board until it is the thing you meant.',
              action: 'Open Canvas',
            },
            embed: {
              title: 'Embed it where your customers are',
              body: 'Paste one script into your product, website, or customer portal and switch on the capabilities you need.',
              action: 'See the install snippet',
            },
            sell: {
              title: 'Sell it in the Marketplace',
              body: 'List what you built so other teams can install it, and get paid for the idea rather than only using it.',
              action: 'Browse the Marketplace',
            },
          },
        },
        cta: {
          title: 'Put your idea inside your customers’ product',
          body: 'Create a free workspace to get your embed key, turn on the capabilities you want, and ship them to your own site today.',
        },
      },
    },
  },
  zh: {
    embedded: {
      availableCapabilities: '项可嵌入的能力',
      replaces: '可替代 {tools}',
      sell: {
        label: '为什么选择嵌入式能力',
        title: '一段脚本，取代十三份合同',
        description:
          '您在 BuilderForce 中构建的一切都能在您自己的产品中运行——客服、反馈、分析、功能开关、同意管理、状态页。每项能力单独治理，而它们全都通过一次安装的同一段标签抵达。',
        stats: {
          capabilities: '项能力，同一段标签',
          script: '段脚本即可安装',
          stack: '每月，它所替代的单点工具费用',
          yearly: '一年的工具开支从路线图上消失',
        },
        replacesLabel: '可替代这些工具',
        benchmarkNote:
          '对比数字取自同类单点工具在小团队规模下公开的入门档定价。它们只是参照，不是报价——您的实际成本与用量会有所不同。',
        pillars: {
          install: {
            title: '安装一次，随时改主意',
            body: '一段标签放到您的网站上。启用或停用某项能力在您的工作区完成，下次页面加载即生效——无需重新部署，无需再接入一家供应商，也没有新脚本要审查。',
          },
          govern: {
            title: '同意机制内建，而非事后加装',
            body: '每项能力都需单独授权，对应带版本的同意文本，且每一次开启与关闭都会写入不可篡改的工作区日志，可直接交给审计方。',
          },
          own: {
            title: '它始终属于您',
            body: '数据归属您的工作区，体验带着您的品牌，而这项能力正是您在 Canvas 中设计的东西——不是套上您配色的第三方小挂件。',
          },
        },
        loop: {
          title: '从创意，到嵌入，到售出',
          description:
            '我们的使命是帮您把所构建的东西卖出去，因此这条路径贯穿始终：设计体验，交到客户面前，再把它上架给所有人。',
          steps: {
            build: {
              title: '在 Canvas 中构建',
              body: '描述您想要的体验，并在画布上不断打磨，直到它正是您所设想的样子。',
              action: '打开 Canvas',
            },
            embed: {
              title: '嵌入到客户所在之处',
              body: '把一段脚本粘贴到您的产品、网站或客户门户中，然后开启所需的能力。',
              action: '查看安装代码',
            },
            sell: {
              title: '在市场中出售',
              body: '把您构建的成果上架，让其他团队也能安装，并让这个创意本身为您带来收入，而不只是自用。',
              action: '浏览市场',
            },
          },
        },
        cta: {
          title: '把您的创意放进客户的产品里',
          body: '创建免费工作区即可获取嵌入密钥，开启所需能力，今天就发布到您自己的网站。',
        },
      },
    },
  },
  es: {
    embedded: {
      availableCapabilities: 'capacidades que puedes integrar',
      replaces: 'Sustituye a {tools}',
      sell: {
        label: 'Por qué las capacidades integradas',
        title: 'Un solo script en lugar de trece contratos',
        description:
          'Todo lo que creas en BuilderForce puede ejecutarse dentro de tu propio producto: soporte, feedback, analítica, flags, consentimiento, estado. Cada capacidad se gobierna por separado y todas llegan mediante una única etiqueta que instalas una vez.',
        stats: {
          capabilities: 'capacidades en una etiqueta',
          script: 'script que instalar',
          stack: 'al mes en herramientas puntuales a las que sustituye',
          yearly: 'de herramientas al año fuera de tu hoja de ruta',
        },
        replacesLabel: 'Sustituye a herramientas como',
        benchmarkNote:
          'Las cifras de comparación son precios de lista publicados del nivel de entrada de herramientas puntuales equivalentes para equipos pequeños. Son una referencia, no un presupuesto: tus costes y tu uso serán distintos.',
        pillars: {
          install: {
            title: 'Instálalo una vez y cambia de idea después',
            body: 'Una etiqueta va en tu sitio. Activar o desactivar una capacidad ocurre en tu espacio de trabajo y se aplica en la siguiente carga de página: sin redespliegue, sin otro proveedor que incorporar, sin un script nuevo que revisar.',
          },
          govern: {
            title: 'El consentimiento viene de serie, no añadido',
            body: 'Cada capacidad se acepta individualmente, contra un texto de consentimiento versionado, y cada alta y baja queda escrita en un registro inmutable del espacio de trabajo que puedes entregar a un auditor.',
          },
          own: {
            title: 'Sigue siendo tuyo',
            body: 'Los datos pertenecen a tu espacio de trabajo, la experiencia lleva tu marca y la capacidad es lo que diseñaste en Canvas, no un widget de terceros vestido con tus colores.',
          },
        },
        loop: {
          title: 'De la idea a lo integrado a lo vendido',
          description:
            'Nuestro trabajo es ayudarte a vender lo que creas, así que el mismo camino va de principio a fin: diseña la experiencia, ponla ante tus clientes y después publícala para todos los demás.',
          steps: {
            build: {
              title: 'Créalo en Canvas',
              body: 'Describe la experiencia que quieres y dale forma en el tablero hasta que sea exactamente lo que pensabas.',
              action: 'Abrir Canvas',
            },
            embed: {
              title: 'Intégralo donde están tus clientes',
              body: 'Pega un script en tu producto, tu web o tu portal de clientes y activa las capacidades que necesites.',
              action: 'Ver el fragmento de instalación',
            },
            sell: {
              title: 'Véndelo en el Marketplace',
              body: 'Publica lo que has creado para que otros equipos lo instalen y cobra por la idea en lugar de solo usarla.',
              action: 'Explorar el Marketplace',
            },
          },
        },
        cta: {
          title: 'Pon tu idea dentro del producto de tus clientes',
          body: 'Crea un espacio de trabajo gratuito para obtener tu clave de integración, activa las capacidades que quieras y publícalas hoy mismo en tu sitio.',
        },
      },
    },
  },
  fr: {
    embedded: {
      availableCapabilities: 'capacités intégrables',
      replaces: 'Remplace {tools}',
      sell: {
        label: 'Pourquoi les capacités intégrées',
        title: 'Un seul script au lieu de treize contrats',
        description:
          'Tout ce que vous construisez dans BuilderForce peut fonctionner à l’intérieur de votre propre produit : support, retours, analytique, feature flags, consentement, page d’état. Chaque capacité est gouvernée séparément, et toutes arrivent par une balise unique installée une seule fois.',
        stats: {
          capabilities: 'capacités dans une seule balise',
          script: 'script à installer',
          stack: 'par mois d’outils spécialisés remplacés',
          yearly: 'd’outillage par an retiré de votre feuille de route',
        },
        replacesLabel: 'Remplace des outils comme',
        benchmarkNote:
          'Les chiffres de comparaison sont les tarifs publics d’entrée de gamme d’outils spécialisés équivalents, pour une petite équipe. Ce sont des repères, pas des devis : vos coûts et vos usages seront différents.',
        pillars: {
          install: {
            title: 'Installez une fois, changez d’avis ensuite',
            body: 'Une balise sur votre site. Activer ou désactiver une capacité se fait dans votre espace de travail et s’applique au chargement suivant : aucun redéploiement, aucun nouveau fournisseur à intégrer, aucun script supplémentaire à faire valider.',
          },
          govern: {
            title: 'Le consentement est intégré, pas rajouté',
            body: 'Chaque capacité s’active individuellement, face à un texte de consentement versionné, et chaque activation comme chaque retrait est inscrit dans un journal d’espace de travail inaltérable, remettable à un auditeur.',
          },
          own: {
            title: 'Cela reste à vous',
            body: 'Les données appartiennent à votre espace de travail, l’expérience porte votre marque, et la capacité est bien ce que vous avez conçu dans Canvas — pas un widget tiers habillé à vos couleurs.',
          },
        },
        loop: {
          title: 'De l’idée à l’intégration, puis à la vente',
          description:
            'Notre métier est de vous aider à vendre ce que vous créez : le même chemin va donc jusqu’au bout — concevez l’expérience, mettez-la devant vos clients, puis publiez-la pour tous les autres.',
          steps: {
            build: {
              title: 'Construisez-la dans Canvas',
              body: 'Décrivez l’expérience voulue et façonnez-la sur le tableau jusqu’à ce qu’elle soit exactement ce que vous aviez en tête.',
              action: 'Ouvrir Canvas',
            },
            embed: {
              title: 'Intégrez-la là où sont vos clients',
              body: 'Collez un script dans votre produit, votre site ou votre portail client, puis activez les capacités dont vous avez besoin.',
              action: 'Voir le code d’installation',
            },
            sell: {
              title: 'Vendez-la sur la Marketplace',
              body: 'Publiez ce que vous avez construit pour que d’autres équipes l’installent, et soyez payé pour l’idée au lieu de seulement l’utiliser.',
              action: 'Parcourir la Marketplace',
            },
          },
        },
        cta: {
          title: 'Placez votre idée à l’intérieur du produit de vos clients',
          body: 'Créez un espace de travail gratuit pour obtenir votre clé d’intégration, activez les capacités souhaitées et publiez-les dès aujourd’hui sur votre site.',
        },
      },
    },
  },
  de: {
    embedded: {
      availableCapabilities: 'einbettbare Funktionen',
      replaces: 'Ersetzt {tools}',
      sell: {
        label: 'Warum eingebettete Funktionen',
        title: 'Ein Skript statt dreizehn Verträgen',
        description:
          'Alles, was Sie in BuilderForce bauen, kann in Ihrem eigenen Produkt laufen: Support, Feedback, Analytics, Feature-Flags, Einwilligung, Statusseite. Jede Funktion wird einzeln gesteuert, und alle kommen über ein einziges Tag, das Sie einmal einbauen.',
        stats: {
          capabilities: 'Funktionen in einem Tag',
          script: 'Skript zum Einbauen',
          stack: 'pro Monat an Einzeltools, für die es einsteht',
          yearly: 'Tooling pro Jahr weniger auf der Roadmap',
        },
        replacesLabel: 'Steht für Tools wie',
        benchmarkNote:
          'Die Vergleichszahlen sind veröffentlichte Einstiegs-Listenpreise vergleichbarer Einzeltools für kleine Teams. Sie sind ein Anhaltspunkt, kein Angebot — Ihre Kosten und Nutzung werden abweichen.',
        pillars: {
          install: {
            title: 'Einmal einbauen, später umentscheiden',
            body: 'Ein Tag kommt auf Ihre Website. Eine Funktion ein- oder auszuschalten geschieht in Ihrem Workspace und greift beim nächsten Seitenaufruf — kein Redeploy, kein weiterer Anbieter zum Onboarden, kein neues Skript zur Prüfung.',
          },
          govern: {
            title: 'Einwilligung ist eingebaut, nicht angeflanscht',
            body: 'Jede Funktion wird einzeln aktiviert, gegen einen versionierten Einwilligungstext, und jede Zustimmung wie jeder Widerruf landet in einem unveränderlichen Workspace-Protokoll, das Sie einer Prüfung vorlegen können.',
          },
          own: {
            title: 'Es bleibt Ihres',
            body: 'Die Daten gehören Ihrem Workspace, die Erfahrung trägt Ihre Marke, und die Funktion ist das, was Sie in Canvas entworfen haben — kein Fremd-Widget in Ihren Farben.',
          },
        },
        loop: {
          title: 'Von der Idee über die Einbettung zum Verkauf',
          description:
            'Unsere Aufgabe ist es, Ihnen beim Verkaufen dessen zu helfen, was Sie bauen. Deshalb führt derselbe Weg bis zum Ende: Erfahrung entwerfen, vor Ihre Kunden bringen, dann für alle anderen listen.',
          steps: {
            build: {
              title: 'In Canvas bauen',
              body: 'Beschreiben Sie die gewünschte Erfahrung und formen Sie sie auf dem Board, bis sie genau das ist, was Sie gemeint haben.',
              action: 'Canvas öffnen',
            },
            embed: {
              title: 'Dort einbetten, wo Ihre Kunden sind',
              body: 'Fügen Sie ein Skript in Ihr Produkt, Ihre Website oder Ihr Kundenportal ein und schalten Sie die benötigten Funktionen frei.',
              action: 'Installations-Snippet ansehen',
            },
            sell: {
              title: 'Im Marketplace verkaufen',
              body: 'Listen Sie, was Sie gebaut haben, damit andere Teams es installieren können — und verdienen Sie an der Idee, statt sie nur selbst zu nutzen.',
              action: 'Marketplace ansehen',
            },
          },
        },
        cta: {
          title: 'Bringen Sie Ihre Idee in das Produkt Ihrer Kunden',
          body: 'Legen Sie einen kostenlosen Workspace an, holen Sie sich Ihren Embed-Key, aktivieren Sie die gewünschten Funktionen und bringen Sie sie noch heute auf Ihre eigene Website.',
        },
      },
    },
  },
};
