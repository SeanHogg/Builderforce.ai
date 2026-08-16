// Every card on <MethodologySection> is now a link into a canvas seeded with a
// prompt for THAT act or THAT proof. The prompt is a registry copy field so the
// eleven cards cannot advertise one thing and seed another.
//
// The prompts deliberately END with a colon and an invitation: the canvas drops
// them straight into the composer, so the visitor's own idea is the next thing
// they type rather than something they have to splice into the middle.
//
// Usage: node scripts/i18n-merge.mjs scripts/i18n-patch-methodology-actions.mjs
export const PATCHES = {
  en: {
    methodology: {
      cardAction: 'Open on the canvas →',
      cardActionFor: 'Open {name} on the canvas',
      step: {
        read: { prompt: 'Read this idea and turn it into a specification — what it has to do, which capabilities it names, and the limits I have already set. Do not build anything yet. My idea: ' },
        prove: { prompt: 'Rank the ways to make this idea real, cheapest first. For each, tell me the question it answers and what it would cost. For the one you recommend, give me the kill condition — the number that would tell me to stop. My idea: ' },
        build: { prompt: 'Build the proof we settled on: write the files, stand up the endpoints, seed the tickets and publish it to an address I can send to somebody. What we are building: ' },
      },
      proof: {
        'demo-video': { prompt: 'Make a 90-second demo video for this idea — a timed reel and a narration script I can record today. The idea: ' },
        'clickable-prototype': { prompt: 'Build a clickable prototype of this flow: every screen, no backend, no data, and a click log so I can see where people stall. The flow: ' },
        'smoke-test': { prompt: 'Build a smoke test for this idea — a fake-door landing page, a waitlist and a demand console. Set the signup threshold that would tell me to stop before we start. The idea: ' },
        'wizard-of-oz': { prompt: 'Set up a Wizard of Oz test: a real front end with an operator queue behind it on an SLA clock, using the routes the built system will use. The service: ' },
        poc: { prompt: 'Isolate the riskiest step in this idea behind a trial harness and report a pass rate against a bar we agree first. The risky part: ' },
        pilot: { prompt: 'Plan a bounded pilot: a named cohort, a weekly feedback loop and written exit criteria so it ends instead of becoming the product. What we are piloting: ' },
        'phone-line': { prompt: 'Stand up a phone line for this — an inbound number that answers and understands, plus an endpoint that places outbound calls. What it should handle: ' },
        'live-system': { prompt: 'Build the whole system and run it at a real address, with an operations console and an on-call runbook for the first incident. The system: ' },
      },
    },
  },

  zh: {
    methodology: {
      cardAction: '在画布中打开 →',
      cardActionFor: '在画布中打开"{name}"',
      step: {
        read: { prompt: '读懂这个想法，并把它转化为一份规格说明：它要做什么、涉及哪些能力，以及我已经设定的限制。先不要构建任何东西。我的想法：' },
        prove: { prompt: '把让这个想法成真的各种方式按从便宜到昂贵排序。对每一种，说明它回答的是什么问题、大致要付出多少代价。对于你推荐的那一种，给出终止条件——那个会让我叫停的数字。我的想法：' },
        build: { prompt: '构建我们选定的验证方式：写好文件、部署接口、创建工单，并发布到一个我可以发给别人的地址。我们要构建的是：' },
      },
      proof: {
        'demo-video': { prompt: '为这个想法做一段 90 秒的演示视频——一份计时脚本和一份可供我今天就录制的旁白稿。想法是：' },
        'clickable-prototype': { prompt: '为这个流程做一个可点击原型：包含每一个界面，没有后端也没有数据，并记录点击日志，让我看到人们在哪里卡住。流程是：' },
        'smoke-test': { prompt: '为这个想法做一次烟雾测试——一个"假门"落地页、一份等待名单和一个需求控制台。在开始之前就设定好那个会让我叫停的注册阈值。想法是：' },
        'wizard-of-oz': { prompt: '搭建一次"绿野仙踪"测试：一个真实的前端，背后有人工队列并带 SLA 计时，走的是最终系统将要使用的同一批路由。这项服务是：' },
        poc: { prompt: '把这个想法中风险最高的环节隔离到一套试验框架中，并按我们事先约定的标准报告通过率。风险最高的部分是：' },
        pilot: { prompt: '规划一次有边界的试点：指定的用户群、每周反馈循环，以及书面的退出标准，让它能够结束而不是变成产品本身。我们要试点的是：' },
        'phone-line': { prompt: '为它开通一条电话线路——一个会接听并能理解的来电号码，外加一个可发起外呼的接口。它需要处理的是：' },
        'live-system': { prompt: '构建整套系统并让它运行在一个真实地址上，配备运维控制台和应对首次故障的值班手册。这套系统是：' },
      },
    },
  },

  es: {
    methodology: {
      cardAction: 'Abrir en el lienzo →',
      cardActionFor: 'Abrir {name} en el lienzo',
      step: {
        read: { prompt: 'Lee esta idea y conviértela en una especificación: qué tiene que hacer, qué capacidades nombra y los límites que ya he fijado. No construyas nada todavía. Mi idea: ' },
        prove: { prompt: 'Ordena las formas de hacer real esta idea, de la más barata a la más cara. Para cada una, dime qué pregunta responde y cuánto costaría. Para la que recomiendes, dame la condición de parada: el número que me diría que pare. Mi idea: ' },
        build: { prompt: 'Construye la prueba que elegimos: escribe los archivos, levanta los endpoints, crea los tickets y publícalo en una dirección que pueda enviar a alguien. Lo que vamos a construir: ' },
      },
      proof: {
        'demo-video': { prompt: 'Haz un vídeo demo de 90 segundos para esta idea: un montaje cronometrado y un guion de narración que pueda grabar hoy. La idea: ' },
        'clickable-prototype': { prompt: 'Construye un prototipo clicable de este flujo: todas las pantallas, sin backend ni datos, y un registro de clics para ver dónde se atasca la gente. El flujo: ' },
        'smoke-test': { prompt: 'Construye una prueba de humo para esta idea: una landing de puerta falsa, una lista de espera y una consola de demanda. Fija el umbral de registros que me diría que pare, antes de empezar. La idea: ' },
        'wizard-of-oz': { prompt: 'Monta una prueba Mago de Oz: un front end real con una cola de operadores detrás y reloj de SLA, usando las mismas rutas que usará el sistema construido. El servicio: ' },
        poc: { prompt: 'Aísla el paso más arriesgado de esta idea tras un banco de pruebas y reporta una tasa de acierto frente a un listón que acordemos antes. La parte arriesgada: ' },
        pilot: { prompt: 'Planifica un piloto acotado: un grupo definido, un ciclo de feedback semanal y criterios de salida por escrito para que termine en vez de convertirse en el producto. Lo que vamos a pilotar: ' },
        'phone-line': { prompt: 'Levanta una línea telefónica para esto: un número entrante que conteste y entienda, más un endpoint que realice llamadas salientes. Lo que debe atender: ' },
        'live-system': { prompt: 'Construye el sistema completo y ponlo a funcionar en una dirección real, con consola de operaciones y un manual de guardia para el primer incidente. El sistema: ' },
      },
    },
  },

  fr: {
    methodology: {
      cardAction: 'Ouvrir dans le canevas →',
      cardActionFor: 'Ouvrir {name} dans le canevas',
      step: {
        read: { prompt: 'Lis cette idée et transforme-la en spécification : ce qu’elle doit faire, les capacités qu’elle nomme et les limites que j’ai déjà posées. Ne construis rien pour l’instant. Mon idée : ' },
        prove: { prompt: 'Classe les façons de rendre cette idée réelle, de la moins chère à la plus chère. Pour chacune, dis-moi à quelle question elle répond et ce qu’elle coûterait. Pour celle que tu recommandes, donne-moi la condition d’arrêt : le chiffre qui me dirait de m’arrêter. Mon idée : ' },
        build: { prompt: 'Construis la preuve que nous avons retenue : écris les fichiers, mets les endpoints en service, crée les tickets et publie le tout à une adresse que je peux envoyer à quelqu’un. Ce que nous construisons : ' },
      },
      proof: {
        'demo-video': { prompt: 'Fais une vidéo de démo de 90 secondes pour cette idée : un montage minuté et un script de narration que je peux enregistrer aujourd’hui. L’idée : ' },
        'clickable-prototype': { prompt: 'Construis un prototype cliquable de ce parcours : tous les écrans, sans back-end ni données, avec un journal de clics pour voir où les gens bloquent. Le parcours : ' },
        'smoke-test': { prompt: 'Construis un test de fumée pour cette idée : une landing « fausse porte », une liste d’attente et une console de demande. Fixe le seuil d’inscriptions qui me dirait d’arrêter, avant de commencer. L’idée : ' },
        'wizard-of-oz': { prompt: 'Mets en place un test Magicien d’Oz : un vrai front-end avec une file d’opérateurs derrière et une horloge de SLA, empruntant les routes que le système construit utilisera. Le service : ' },
        poc: { prompt: 'Isole l’étape la plus risquée de cette idée derrière un banc d’essai et rapporte un taux de réussite face à une barre fixée à l’avance. La partie risquée : ' },
        pilot: { prompt: 'Planifie un pilote borné : une cohorte nommée, une boucle de retour hebdomadaire et des critères de sortie écrits, pour qu’il se termine au lieu de devenir le produit. Ce que nous pilotons : ' },
        'phone-line': { prompt: 'Mets en place une ligne téléphonique : un numéro entrant qui répond et comprend, plus un endpoint qui passe des appels sortants. Ce qu’elle doit traiter : ' },
        'live-system': { prompt: 'Construis le système complet et fais-le tourner à une vraie adresse, avec une console d’exploitation et un runbook d’astreinte pour le premier incident. Le système : ' },
      },
    },
  },

  de: {
    methodology: {
      cardAction: 'Im Canvas öffnen →',
      cardActionFor: '{name} im Canvas öffnen',
      step: {
        read: { prompt: 'Lies diese Idee und mach eine Spezifikation daraus: was sie leisten muss, welche Fähigkeiten sie benennt und welche Grenzen ich bereits gesetzt habe. Baue noch nichts. Meine Idee: ' },
        prove: { prompt: 'Sortiere die Wege, diese Idee real zu machen, vom günstigsten zum teuersten. Sag mir zu jedem, welche Frage er beantwortet und was er kosten würde. Für den, den du empfiehlst: nenne die Abbruchbedingung – die Zahl, die mir sagen würde aufzuhören. Meine Idee: ' },
        build: { prompt: 'Baue den Nachweis, für den wir uns entschieden haben: schreibe die Dateien, bringe die Endpunkte in Betrieb, lege die Tickets an und veröffentliche das Ganze unter einer Adresse, die ich jemandem schicken kann. Was wir bauen: ' },
      },
      proof: {
        'demo-video': { prompt: 'Mach ein 90-Sekunden-Demo-Video für diese Idee: einen getakteten Ablauf und einen Sprechertext, den ich heute aufnehmen kann. Die Idee: ' },
        'clickable-prototype': { prompt: 'Baue einen klickbaren Prototyp dieses Ablaufs: jeden Screen, ohne Backend und ohne Daten, mit einem Klickprotokoll, damit ich sehe, wo Leute hängen bleiben. Der Ablauf: ' },
        'smoke-test': { prompt: 'Baue einen Rauchtest für diese Idee: eine Fake-Door-Landingpage, eine Warteliste und eine Nachfrage-Konsole. Lege den Anmeldeschwellenwert, der mir sagen würde aufzuhören, vor dem Start fest. Die Idee: ' },
        'wizard-of-oz': { prompt: 'Richte einen Wizard-of-Oz-Test ein: ein echtes Frontend mit einer Bearbeiter-Warteschlange dahinter auf SLA-Uhr, über dieselben Routen, die das gebaute System nutzen wird. Der Dienst: ' },
        poc: { prompt: 'Isoliere den riskantesten Schritt dieser Idee hinter einem Testrahmen und melde eine Erfolgsquote gegen eine vorher vereinbarte Latte. Der riskante Teil: ' },
        pilot: { prompt: 'Plane einen begrenzten Pilot: eine benannte Gruppe, eine wöchentliche Feedbackschleife und schriftliche Ausstiegskriterien, damit er endet statt zum Produkt zu werden. Was wir pilotieren: ' },
        'phone-line': { prompt: 'Richte dafür eine Telefonleitung ein: eine eingehende Nummer, die abnimmt und versteht, plus einen Endpunkt für ausgehende Anrufe. Was sie abdecken soll: ' },
        'live-system': { prompt: 'Baue das ganze System und betreibe es unter einer echten Adresse, mit Betriebskonsole und einem Rufbereitschafts-Runbook für den ersten Vorfall. Das System: ' },
      },
    },
  },
};
