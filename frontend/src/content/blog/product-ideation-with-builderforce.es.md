> **Novedad del producto:** Brainstorm, el Constructor de flujos de trabajo y el lanzador del IDE ya no son destinos de creación principales independientes. Sus capacidades aparecen ahora como objetos vivos en un [Lienzo de Creación](/creation-canvas). Los enlaces existentes siguen funcionando, pero el trabajo nuevo debería empezar en una sesión de creación.

Todo producto empieza con una idea y termina —con suerte— con algo lanzado. El trecho entre esos dos momentos es donde muere la mayoría de las ideas: requisitos poco claros, un alcance que se desborda, las personas equivocadas trabajando en las cosas equivocadas.

Builderforce está diseñado para acortar ese trecho. Este artículo documenta el flujo original, repartido en varias superficies, y explica los conceptos que llevaron a su sucesor: una única sesión de creación visual en la que la conversación con Brain, los prototipos, el código, los proyectos, las tareas y los agentes contratados permanecen conectados.

![Canal de ideación que va de Brainstorm a la estructuración en el IDE, al Timeline, a la contratación de agentes de Workforce y a la revisión y el lanzamiento](/blog/product-ideation.svg)

---

## El escenario

Imagina que quieres crear una **herramienta SaaS que ayude a los freelancers a registrar su tiempo y generar facturas automáticamente**. Tienes el germen de una idea y nada más: ni especificación, ni diseño, ni equipo.

Usemos Builderforce para convertir ese germen en un plan accionable.

---

## Paso 1: captura y amplía la idea con Brainstorm

Empieza en tu [Panel](/dashboard), crea un proyecto nuevo —llámalo *«Herramienta de tiempo y facturas para freelancers»*— y abre la pestaña **Brainstorm**.

Brainstorm es un espacio de trabajo de ideación facilitado por IA. A diferencia de un documento en blanco, participa activamente: hace preguntas aclaratorias, saca a la luz supuestos y amplía tu idea hasta convertirla en artefactos estructurados.

### Una sesión de Brainstorm

Escribe tu idea germen en el prompt de Brainstorm:

> «Una herramienta SaaS para que los freelancers registren el tiempo facturable y generen facturas automáticamente. Quiero que sea sencilla, que funcione bien en móvil y que se integre con Stripe para los pagos.»

Builderforce responde con una ampliación estructurada:

- **Problema central del usuario**: los freelancers pierden ingresos porque el registro es manual y crear facturas lleva mucho tiempo
- **Usuarios objetivo**: freelancers independientes y agencias pequeñas (de 2 a 10 personas)
- **Trabajos por hacer clave**: iniciar/detener temporizadores, asignar tiempo a clientes/proyectos, generar facturas en PDF, cobrar
- **Diferenciadores por explorar**: tarifas sugeridas por IA, recordatorios de seguimiento automáticos, sincronización con el calendario
- **Riesgos y supuestos**: adopción de Stripe, patrones de uso en móvil, disposición a pagar frente a alternativas gratuitas

### Afinar con preguntas de seguimiento

Las sesiones de Brainstorm son conversacionales. Puedes ir más allá:

> «¿Cuáles son los tres principales competidores y cómo debería diferenciarme?»

> «¿Cuál es la v1 más sencilla posible que aporte valor real?»

> «Desglosa el MVP en historias de usuario.»

Cada respuesta se apoya en el contexto anterior, así que tu ideación es acumulativa en lugar de fragmentada. Al final de una sesión de 20 minutos normalmente tienes:

- Una **declaración del problema** clara
- Una **lista de funcionalidades** priorizada
- Un conjunto de **historias de usuario** listas para el backlog
- Un **registro de riesgos** inicial

Exporta la sesión como markdown directamente al espacio de trabajo del IDE de tu proyecto.

---

## Paso 2: estructura el plan en el IDE

Abre la pestaña **IDE**. Encontrarás la exportación de Brainstorm en el explorador de archivos. Ahora usa el chat de IA del IDE para transformar ese markdown en bruto en artefactos de proyecto estructurados.

### Generar un documento de requisitos de producto

Pide al chat de IA:

> «Convierte el resultado de Brainstorm en un PRD estructurado con estas secciones: Visión general, Objetivos, Fuera de alcance, Historias de usuario, Restricciones técnicas y Métricas de éxito.»

La IA redacta el PRD directamente en el editor. Lo revisas, lo editas y lo guardas como `docs/PRD.md`.

### Generar un boceto de arquitectura técnica

Sigue en el mismo hilo de chat:

> «A partir del PRD, sugiere una arquitectura técnica ligera: qué servicios necesitamos, cómo se comunican y cómo es el modelo de datos.»

La respuesta te da un diagrama de arquitectura inicial (en marcado Mermaid) y una propuesta de stack. Guárdalo como `docs/ARCHITECTURE.md`.

### Crear un backlog

Pide un backlog en un formato estructurado:

> «Convierte las historias de usuario del PRD en un backlog en forma de tabla markdown con estas columnas: ID de historia, Descripción, Prioridad (P0/P1/P2), Esfuerzo estimado (S/M/L), Dependencias.»

Revisa la tabla, ajusta las prioridades y guárdala como `docs/BACKLOG.md`.

Ya tienes un conjunto vivo de documentación del proyecto, generado y gestionado íntegramente desde el IDE, sin herramientas aparte.

---

## Paso 3: traza el cronograma

Cambia a la pestaña **Timeline**. Es el planificador visual de hitos de Builderforce.

Con el backlog en la mano, crea los hitos:

| Hito | Enfoque | Objetivo |
|---|---|---|
| **M1 – Temporizador básico** | Iniciar/detener el temporizador, asignar a cliente/proyecto | Semana 2 |
| **M2 – Generación de facturas** | Generar y descargar facturas en PDF | Semana 4 |
| **M3 – Integración con Stripe** | Cobro de pagos y seguimiento de su estado | Semana 6 |
| **M4 – Pulido para móvil** | Interfaz adaptable, compatibilidad con PWA | Semana 8 |
| **M5 – Lanzamiento** | Lista de invitaciones a la beta, onboarding, página de precios | Semana 10 |

La vista Timeline te muestra el plan en formato Gantt. Puedes arrastrar los hitos para ajustar fechas y marcar elementos bloqueados. Se convierte en tu única fuente de verdad sobre el ritmo de entrega.

---

## Paso 4: contrata agentes especializados en Workforce

Con un plan claro, la siguiente pregunta es: *¿quién hace el trabajo?*

En lugar de contratar desarrolladores de inmediato (o intentar hacerlo todo tú), aquí es donde el [Registro de Workforce](/workforce) cambia la ecuación económica.

### Contratar un agente de investigación UX

Tu primera incógnita es el comportamiento de los usuarios. Antes de escribir una sola línea de código, quieres validar tus supuestos sobre cómo registran realmente su tiempo los freelancers hoy en día.

Busca en Workforce un agente de **investigación UX**. Contrata a `ux-researcher-v2` en tu proyecto. Asígnale una tarea:

> «Revisa el PRD e identifica los cinco supuestos sobre el comportamiento de los usuarios que conllevan mayor riesgo para el producto. Para cada uno, sugiere un método de validación rápido (encuesta, prueba de prototipo, análisis de la competencia, etc.).»

En minutos tienes un plan de investigación estructurado, sin necesidad de tener un investigador de usuarios en plantilla.

### Contratar un agente de arquitectura frontend

Para la construcción técnica, contrata a un especialista en **arquitectura frontend**. Asígnale:

> «A partir del documento de arquitectura, crea el andamiaje de un proyecto Next.js 15 con TypeScript, Tailwind CSS, integración con Stripe y un backend en Supabase. Crea la estructura inicial de archivos y el plan de rutas.»

El agente produce un andamiaje inicial y una guía de configuración detallada. Tu propio tiempo de desarrollo cae en picado porque las decisiones estructurales ya están tomadas.

### Contratar un agente de copywriting

Un producto sin palabras es invisible. Contrata a un agente **Copywriter** y asígnale:

> «Escribe el titular de la landing page, el subtítulo, las descripciones de funcionalidades (tres) y una sección de precios para un SaaS de registro de tiempo dirigido a freelancers independientes. Tono: cercano, profesional, sin jerga.»

Itera sobre el texto dentro del IDE hasta que estés satisfecho. Expórtalo listo para el traspaso a diseño.

### Coordinar desde el panel de tareas

A medida que trabajan más agentes en tu proyecto, el **panel de tareas** se convierte en tu centro de coordinación. Cada tarea muestra:

- Qué agente la tiene asignada
- Estado actual (en cola, en curso, completada, bloqueada)
- Artefactos de entrada y de salida
- Coste en tiempo y en tokens

Puedes ver de un vistazo si la investigación UX, el andamiaje técnico y los textos avanzan en paralelo, exactamente igual que seguirías el tablero de sprint de un equipo real.

---

## Paso 5: revisa, itera y lanza

La ideación no es algo que ocurra una sola vez. A medida que avanza el proyecto:

- **Vuelve a Brainstorm** cuando llegues a un punto de decisión que necesite ideas frescas
- **Actualiza el PRD y el backlog** en el IDE a medida que evolucionan los requisitos
- **Contrata nuevos agentes especializados** cuando surjan nuevas carencias de habilidades
- **Reajusta el Timeline** a medida que descubres qué lleva más tiempo de lo previsto

Todo el ciclo —idear, planificar, asignar, construir, revisar— ocurre dentro de un único proyecto de Builderforce. Sin cambiar de herramienta, sin perder contexto.

---

## La ventaja que se acumula

Esta es la clave: **cada agente que entrenas y cada sesión que ejecutas hacen que la plataforma sea más inteligente para ti**.

- Las sesiones de Brainstorm se convierten en una base de conocimiento consultable de tu forma de pensar
- Los agentes entrenados codifican de forma permanente las convenciones y preferencias de tu equipo
- Los agentes que la comunidad publica en Workforce mejoran y se especializan con el tiempo

Empezar aquí tu ideación significa que no solo terminas antes este proyecto: estás construyendo una memoria organizativa que acelera todos los proyectos que vengan después.

---

## Empieza tu próxima idea

1. **[Crea un proyecto nuevo](/dashboard)** y abre la pestaña Brainstorm
2. Suelta tu idea germen y deja que la IA la amplíe
3. Expórtala al IDE y estructura tu PRD y tu backlog
4. Planifica los hitos en el Timeline
5. Contrata agentes especializados del [Registro de Workforce](/workforce) para ejecutar en paralelo

El mejor momento para empezar fue ayer. El segundo mejor es ahora mismo. 🚀
