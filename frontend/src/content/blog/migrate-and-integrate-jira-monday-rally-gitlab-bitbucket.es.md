La mayor razón por la que los equipos siguen en una herramienta que se les ha quedado pequeña es la propia mudanza. Años de tickets, una taxonomía de proyectos que todos se saben de memoria, responsables, sprints, story points: el miedo no es a la herramienta nueva, es a perder el historial de la antigua en el cambio. Por eso BuilderForce trata la migración como un flujo de primera clase, reversible hasta que confirmas, y no como un botón de importar de un solo disparo en el que cruzas los dedos.

![Diagrama de embudo: los proveedores con insignia de migración Jira, monday, Rally, GitLab, Bitbucket y GitHub, más las fuentes solo de sincronización, alimentan un asistente de migración por etapas de siete pasos que produce un tablero de BuilderForce y una conexión de sincronización en vivo](/blog/migrate-integrate.svg)

## Dos formas de adoptar: migrar, sincronizar o ambas

No todos los equipos quieren irse. Algunos quieren mudarse por completo; otros nunca quieren dejar Jira y solo quieren que los datos fluyan hacia BuilderForce para que sus agentes y paneles puedan actuar sobre ellos. Cada integración admite ambas opciones, elegidas en cada ejecución:

- **Migrar**: una importación única de tus elementos históricos como tareas de BuilderForce.
- **Sincronizar**: una conexión continua que sigue consultando, de modo que los cambios llegan de forma constante. Nunca dejas tu gestor de tareas.
- **Ambas**: importa el historial *y* configura la conexión en vivo.

## Todo lo que conectamos

La galería de Integraciones (en **Settings → Integrations**) es el hogar en el espacio de trabajo de cada sistema externo. Cada proveedor es una tarjeta que conectas, configuras y vigilas, con credenciales, conexiones en vivo y una pestaña de actividad y diagnóstico que muestra cada ejecución de sincronización.

**Trabajo y gestión de proyectos:** Jira, monday.com, Rally (CA Agile Central), Linear, Asana, ClickUp.

**Control de código fuente e incidencias:** GitHub, GitLab, Bitbucket, *tanto* sus gestores de incidencias (migrados como cualquier tablero) **como** sus repositorios (conectados para código, ramas y pull requests).

**Gestión de servicios de TI:** ServiceNow, Freshservice: los incidentes y tickets fluyen a la lente de Calidad.

**Monitorización y guardias:** Sentry, PagerDuty: las alertas y los incidentes se convierten en trabajo accionable.

Los proveedores que admiten el asistente de migración llevan una insignia de **Migration**: hoy, Jira, monday, Rally, GitLab, Bitbucket y GitHub. El resto se conecta para sincronización continua.

## El asistente de migración: prepara antes de aterrizar

Nada toca tus proyectos, tareas o miembros reales hasta que pulses importar. Todo lo anterior vive en un búfer de preparación que puedes revisar, ajustar y abandonar:

1. **Conectar**: elige la credencial y el modo (migrar / sincronizar / ambas).
2. **Descubrir**: BuilderForce lee el sistema externo y prepara sus proyectos, tipos de elemento y usuarios. Aún no se escribe nada.
3. **Mapear y combinar proyectos**: asigna cada proyecto externo a un proyecto nuevo de BuilderForce, o mapea varios sobre *un* proyecto para combinarlos. El clásico problema de «tenemos cinco proyectos de Jira que en realidad son un solo producto» se reduce a cinco filas apuntando al mismo destino.
4. **Mapear tipos de elemento**: convierte `Story`, `Bug`, `Epic`, `Defect` e `incident` en el tipo de tarea de BuilderForce y el estado inicial correctos. Este mapeo también se guarda para la sincronización continua, de modo que las tareas sincronizadas aterrizan en el carril adecuado en lugar de un backlog genérico.
5. **Mapear usuarios**: invita a los responsables externos que quieras, o mapéalos a miembros existentes. Los elementos importados conservan su responsable cuando la persona se mapea a un miembro.
6. **Revisar**: consulta los elementos preparados y desmarca todo lo que quieras dejar atrás.
7. **Importar**: se crean los proyectos (o se combinan), se importan las tareas con su tipo, estado, story points y responsable, se invita a los usuarios y, si elegiste sincronizar, se crean las conexiones en vivo para que el tablero se mantenga al día solo.

Como los elementos importados quedan vinculados a su origen, la primera sincronización tras una migración es una operación nula limpia, no una tormenta de duplicados.

## Deja que el Brain lo haga

Todo el flujo está disponible para el Brain como herramientas. Puedes limitarte a decir:

> «Conecta Bitbucket: aquí tienes el token de acceso y el espacio de trabajo. Pruébalo y luego inicia una migración.»

El Brain guarda la credencial (cifrada), valida la conexión, inicia la ejecución y abre el panel de migración a la **izquierda** de tu pantalla, justo donde puede trabajar junto al Brain, que vive a la derecha. Tú mapeas, revisas e importas; él se encarga de la fontanería. Conectar, validar, conciliar, importar: todo conversando.

## Por qué importa

El miedo a migrar es un impuesto sobre cada buena decisión que un equipo podría tomar. Al preparar todo por etapas, dejarte combinar y remapear al entrar, preservar a las personas y el historial, y ofrecer «solo sincroniza, no te mudes» como opción de primera clase, BuilderForce elimina ese impuesto. Evalúas con tus datos reales, en tu estructura real, sin destruir nada, y puedes cambiar de opinión hasta el momento mismo en que confirmas.
