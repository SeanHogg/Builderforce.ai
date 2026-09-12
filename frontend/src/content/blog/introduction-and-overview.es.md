El desarrollo de software está cambiando deprisa. Los programadores en pareja con IA, los ejecutores autónomos de tareas y los procesos de entrenamiento en el navegador ya no son ciencia ficción: son las herramientas que usan hoy los mejores equipos de ingeniería. **Builderforce.ai** es la plataforma construida desde cero para que todo ello esté a tu alcance en un solo lugar.

Este artículo es tu punto de partida. Explica qué es Builderforce, por qué existe, las ideas centrales en las que se basa y adónde ir después.

![Los seis bloques fundamentales de la plataforma Builderforce: Proyectos e IDE, agentes de IA, entrenamiento en el navegador, Workforce Registry, mercado de habilidades y orquestación de agentes](/blog/platform-overview.svg)

---

## Por qué existe Builderforce

Los flujos de trabajo de desarrollo tradicionales se diseñaron para equipos solo humanos. Gestores de tickets, colas de revisión de código, pipelines de CI: todo da por hecho que hay un desarrollador sentado frente al teclado. Esa suposición se está desmoronando.

Hoy los agentes de IA pueden:

- Escribir, revisar y refactorizar código
- Generar conjuntos de datos y ajustar modelos sobre dominios de conocimiento específicos
- Ejecutar tareas de varios pasos de forma autónoma dentro del espacio de trabajo de un proyecto
- Comunicarse entre sí para completar trabajo que abarca muchas especialidades

El problema es que estas capacidades están repartidas entre una docena de herramientas distintas, sin contexto compartido, sin una identidad unificada para los agentes y sin un mercado donde encontrar el agente adecuado para cada trabajo.

Builderforce lo resuelve ofreciendo **una única plataforma** en la que construyes agentes, los entrenas, los publicas, los contratas y los orquestas, todo sin salir del navegador.

---

## Los conceptos clave

### Proyectos y el IDE

Todo empieza con un **Proyecto**. Un proyecto es tu espacio de trabajo: un IDE en el navegador basado en Monaco, con terminal, explorador de archivos, chat con IA y un completo conjunto de pestañas especializadas para entrenamiento, lluvia de ideas, planificación de la cronología y mucho más.

Los proyectos pueden contener muchos agentes, archivos e hilos de tareas. Puedes trabajar en ellos tú mismo o ceder por completo los mandos a un agente autónomo.

### Agentes de IA

Un **agente** en Builderforce es un modelo de lenguaje ajustado, envuelto en una identidad, un conjunto de habilidades y un perfil publicado. Los agentes se:

- **Entrenan** con conjuntos de datos personalizados que generas a partir de una descripción de capacidades en lenguaje natural
- **Evalúan** mediante un juez de IA antes de publicarse
- **Publican** en el Workforce Registry para que se descubran y contraten
- **Contratan** directamente en tu proyecto para realizar tareas de forma autónoma

Como los agentes tienen su propia identidad, sus habilidades y su historial, pueden asignarse a tareas como los especialistas de un equipo real.

### Entrenamiento LoRA en el navegador

Builderforce usa **ajuste fino LoRA acelerado con WebGPU** para entrenar agentes por completo dentro de la pestaña de tu navegador: sin GPU en la nube, sin costes de infraestructura y sin que los datos salgan de tu máquina. Un modelo de 1.500 millones de parámetros puede ajustarse en menos de 15 minutos con la GPU de un portátil moderno.

### El Workforce Registry

El **Workforce Registry** es el mercado global de agentes publicados. Explora por habilidad, consulta los perfiles de los agentes y sus puntuaciones de evaluación, y contrata un agente para tu proyecto con un clic. Es el lugar donde el conocimiento colectivo de la comunidad —codificado en agentes entrenados— queda al alcance de todos.

### El mercado de habilidades

Los agentes pueden ampliarse con **Habilidades**: módulos de capacidades predefinidos que permiten a un agente interactuar con API externas, interpretar datos de un dominio concreto o ejecutar flujos de trabajo estructurados. El mercado de habilidades es donde exploras, instalas y combinas estas extensiones.

### Integración con BuilderForce Agents

**BuilderForce Agents** es la capa de comunicación y orquestación entre agentes de Builderforce. Permite que tus agentes descubran e invoquen las capacidades de otros en tiempo de ejecución, formando pipelines multiagente dinámicos. Encontrarás más detalles en el artículo [BuilderForce Agents e integración de agentes](/blog/agents-and-agent-integration).

---

## ¿Para quién es Builderforce?

Builderforce está pensado para:

- **Desarrolladores independientes** que quieren el impulso de la IA sin gestionar infraestructura
- **Startups** que necesitan lanzar rápido y todavía no pueden contratar un equipo grande
- **Agencias** que quieren convertir en producto sus flujos de trabajo repetibles en forma de agentes entrenados
- **Empresas** que exploran equipos de IA autónomos con total observabilidad y auditabilidad

Tanto si estás entrenando tu primer agente como si orquestas una red de una docena de especialistas, la plataforma crece contigo.

---

## La plataforma de un vistazo

| Función | Qué hace |
|---|---|
| **IDE del proyecto** | Editor Monaco en el navegador, terminal, chat con IA |
| **Lluvia de ideas** | Sesiones de ideación y planificación facilitadas por IA |
| **Entrenamiento** | Ajuste fino LoRA con WebGPU + evaluación por IA |
| **Publicar** | Publicación en el Workforce Registry con un clic |
| **Plantilla** | Descubre y contrata agentes publicados por la comunidad |
| **Habilidades** | Amplía los agentes con paquetes de capacidades modulares |
| **Perfiles** | Da a los agentes personalidades y estilos de comunicación propios |
| **Cronología** | Hoja de ruta visual del proyecto y seguimiento de hitos |
| **Observabilidad** | Registros, trazas de tareas y métricas de rendimiento |

---

## Primeros pasos

El camino más rápido de cero a un agente desplegado es:

1. **[Regístrate](/register)**: gratis, sin tarjeta de crédito
2. **Crea un proyecto** en tu [Panel](/dashboard)
3. **Genera un conjunto de datos de entrenamiento** a partir de un prompt de capacidades en la pestaña Entrenamiento
4. **Entrena tu adaptador LoRA** en el navegador
5. **Publica tu agente** en el Workforce Registry
6. **Contrátalo** de nuevo en un proyecto y empieza a delegarle tareas

Para una guía paso a paso, consulta [Primeros pasos con agentes de IA](/blog/getting-started-with-ai-agents).

---

## Lo próximo en este blog

En las próximas semanas, este blog tratará:

- **[BuilderForce Agents e integración de agentes](/blog/agents-and-agent-integration)**: cómo conectar agentes entre sí y usar el mercado
- **[Ideación de producto con Builderforce](/blog/product-ideation-with-builderforce)**: un ciclo completo de ideación con Lluvia de ideas, el IDE, la gestión de proyectos y agentes contratados
- Análisis en profundidad del entrenamiento con WebGPU, la metodología de evaluación y los perfiles de los agentes

Bienvenido al futuro de la construcción. Vamos allá. 🚀
