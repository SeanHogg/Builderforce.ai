La mayoría de las empresas guardan sus procedimientos operativos estándar en un wiki que nadie lee, una unidad compartida que nadie encuentra y una carpeta de cumplimiento que nadie ha abierto desde la última auditoría. El conocimiento que debería regir cómo se hace el trabajo está desconectado de donde se hace, y desconectado de los agentes de IA que ahora se encargan de una parte creciente.

El subsistema de **Knowledge Management** de Builderforce.ai pone ese conocimiento en la misma plataforma que el trabajo. Gestiona **SOP, procesos y documentos** con versionado completo, un rastro de auditoría de acuses de lectura pensado para entornos regulados, redacción asistida por IA y coedición en tiempo real, de modo que una única fuente de verdad demuestra el cumplimiento *y* sirve de base a tus agentes.

> El subsistema de Knowledge Management de Builderforce.ai versiona SOP, procesos y documentos con instantáneas inmutables y acuses de lectura con marca de tiempo —evidencia lista para auditoría de SOX, TISAX e ISO 27001—, mientras los mismos documentos sirven de base a la plantilla de agentes.

![Diagrama del subsistema de Knowledge Management: un SOP versionado con instantáneas inmutables v1/v2/v3, seguimiento de acuses de lectura (reconocido, pendiente, vencido) que alimenta un resumen de cumplimiento para SOX, TISAX e ISO 27001, redacción asistida por IA y el mismo documento sirviendo de base a la plantilla de agentes](/blog/knowledge-management.svg)

## Versionado que produce evidencia de auditoría, no solo historial

Cada documento tiene un cuerpo vivo y editable y una instantánea inmutable tomada en cada publicación. Publicar incrementa el número de versión y escribe una copia congelada con una nota de cambio y el usuario que publica. Eso no es un extra: es el mecanismo que hace que los acuses *signifiquen algo*: cuando un usuario reconoce un procedimiento, reconoce una versión concreta y congelada, y el registro demuestra exactamente qué palabras aprobó.

Vuelve a publicar un procedimiento y a las personas que lo necesitan se les pide que lo reconozcan de nuevo. El sistema registra, por usuario y por documento, si está **reconocido, pendiente o vencido**, y los managers obtienen el resumen en `GET /api/knowledge/compliance`: cuántos se requieren, cuántos están reconocidos y quién va con retraso. Ese es el rastro de evidencia que piden los auditores de **SOX**, **TISAX** e **ISO 27001**, generado como efecto secundario de que la gente simplemente haga su trabajo.

## Redacta con IA, mejora con IA

Un SOP en blanco es la razón por la que la mayoría nunca se escribe. El editor de conocimiento transmite un primer borrador a partir de una indicación en lenguaje natural —medido a través del gateway de LLM, escrito en Markdown limpio y con redacción de cumplimiento en mente— y editas a partir de ahí en lugar de desde cero. Apunta el analizador a un procedimiento existente y devuelve hallazgos estructurados (ineficiencia, laguna, riesgo, claridad) con severidad y un flujo mejorado propuesto. La documentación deja de ser una tarea que aplazas y se convierte en un borrador que refinas.

## Escrito en conjunto, en tiempo real

El conocimiento es un resultado de equipo, así que el editor admite coedición en vivo sobre un transporte CRDT (Yjs): la conciencia de presencia muestra quién está en el documento, las ediciones se sincronizan como deltas y tu cursor sobrevive al cambio de un colaborador. Los colaboradores por documento obtienen roles de **editor** o **lector** sobre los valores predeterminados del espacio de trabajo, y las invitaciones se notifican por Slack y correo. Cuando la colaboración en tiempo real no está configurada, el editor recurre al autoguardado: sin dependencias duras.

## La recompensa: conocimiento que los agentes pueden usar

Esto es lo que un wiki no puede hacer. Como tus SOP y procesos viven en la plataforma en la que se ejecutan tus agentes, se convierten en **contexto del agente**. El procedimiento que le dice a una persona cómo gestionar un reembolso es el mismo en el que un agente basa su trabajo. La documentación de cumplimiento deja de ser un centro de costes que mantienes para las auditorías y se convierte en un activo que hace más correcta cada ejecución, de una persona o de un agente.

[Recorre la plataforma →](/product) · [Cómo funciona la gobernanza →](/blog/approval-gates-and-human-oversight) · [Empieza a construir gratis →](/register)
