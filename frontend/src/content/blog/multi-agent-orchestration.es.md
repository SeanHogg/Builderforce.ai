Un único agente generalista puede responder preguntas, escribir código y redactar correos. Pero los flujos de trabajo reales suelen necesitar **agentes especialistas trabajando en conjunto**: un planificador, un programador, un revisor, un encargado del despliegue. El Builderforce Mesh es la capa que los conecta.

![Orquestación multiagente: un agente orquestador descompone un objetivo y dirige cada subtarea a un especialista —planificador, programador, revisor, tester, encargado del despliegue— pasando traspasos JSON estructurados entre nodos](/blog/multi-agent-orchestration.svg)

## El modelo mental del Mesh

Piensa en el Mesh como un bus de mensajes entre agentes. Cada agente es un **nodo** que:

- Se suscribe a un conjunto de **tipos de tarea** que puede gestionar
- Publica los resultados de vuelta en el bus
- Puede invocar a otros agentes como subtareas

El orquestador (que puede ser a su vez un agente) descompone un objetivo de alto nivel en subtareas y dirige cada una al nodo más capaz.

```
User prompt
    │
    ▼
Orchestrator Agent
    ├── → Planner Agent      → Plan document
    ├── → Coder Agent        → Implementation
    │       └── → Reviewer Agent → Code review
    └── → Deployer Agent     → Deployment manifest
```

## Registrar agentes en la plantilla de trabajo

Antes de poder orquestar, los agentes deben **publicarse** en el Workforce Registry. Cada agente declara:

- Un **nombre** y una **descripción** visibles para otros agentes
- Un conjunto de **skills** (etiquetas estructuradas de capacidades)
- Un **endpoint** (el puente BuilderForce Agents que ejecuta el agente)

Publicar es una operación de un clic desde la pestaña Publish del IDE tras el entrenamiento.

## Configurar un flujo de trabajo con el Mesh

### 1. Define los roles

Decide qué agentes especialistas necesita tu flujo de trabajo. Un pipeline de entrega de software podría usar:

| Rol | Responsabilidad |
|------|---------------|
| `planner` | Divide la solicitud de funcionalidad en tareas |
| `coder` | Implementa cada tarea en TypeScript |
| `reviewer` | Revisa los PR en cuanto a corrección y estilo |
| `tester` | Escribe y ejecuta pruebas unitarias |

### 2. Asigna skills

Desde la página de [Skills](/skills), asigna las skills pertinentes al AgentHost de cada agente. Las skills inyectan conocimiento de dominio: un agente `coder` con la skill `typescript-strict`, por ejemplo, aplicará una seguridad de tipos más estricta en su salida.

### 3. Conecta el orquestador

El agente orquestador recibe el prompt inicial y reparte las subtareas. En un proyecto de Builderforce puedes definir la lógica de orquestación en un prompt de sistema del chat:

```
You are an orchestrator. When given a feature request:
1. Use the Planner to generate a task breakdown
2. For each task, invoke the Coder
3. Route each completed task to the Reviewer
4. Aggregate reviewed code and return the final diff
```

El Mesh se encarga del enrutamiento: el orquestador simplemente llama a las skills de los agentes por su nombre.

## Compartir contexto

Los agentes comparten contexto mediante **traspasos estructurados**: cargas JSON que llevan el estado de la tarea, las salidas previas y metadatos. Builderforce serializa y deserializa automáticamente estas cargas, de modo que cada agente recibe exactamente el contexto que necesita.

El contexto de larga duración (historial de conversación, artefactos de código) puede anclarse en un bucket R2 compartido y referenciarse por ID, manteniendo pequeñas las cargas.

## Observabilidad

La página de [Observability](/observability) te ofrece una vista en tiempo real de:

- El flujo de mensajes entre agentes
- La latencia por nodo
- Las tasas de error y los reintentos
- El uso de tokens en todo el mesh

Esto es de un valor incalculable al depurar flujos multiagente complejos: puedes ver exactamente dónde se atascó una tarea o qué agente produjo una salida inesperada.

## Buenas prácticas

**Mantén los agentes pequeños y enfocados.** Un agente programador que solo escribe Python es más fácil de evaluar y mejorar que uno que escribe código, lo revisa y además lo despliega.

**Usa la evaluación con IA en cada agente de forma independiente.** Ajusta con conjuntos de datos específicos en lugar de un corpus gigante. Las puntuaciones de evaluación del Workforce Registry facilitan comparar versiones de agentes.

**Versiona tus agentes.** Publica una nueva versión cuando reentrenes y fija el orquestador a versiones concretas de los agentes durante el desarrollo para evitar regresiones.

## Primeros pasos

¿Listo para construir un mesh? Empieza por [entrenar dos agentes](/dashboard) —un planificador y un programador—, publica ambos y luego crea un proyecto orquestador que los referencie. La interfaz de [chats del Workforce](/workforce?tab=chats) te permite probar el flujo orquestado de forma interactiva antes de comprometerte con un pipeline de producción.
