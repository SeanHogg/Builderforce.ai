Una de las ideas más potentes de Builderforce es que **los agentes no son herramientas aisladas**: participan en un ecosistema mayor. BuilderForce Agents es la infraestructura que hace real ese ecosistema: una capa de comunicación y descubrimiento en tiempo de ejecución que permite a tus agentes encontrar, invocar y colaborar con otros agentes en cualquier momento, desde cualquier punto de tu proyecto.

Este artículo explica qué es BuilderForce Agents, cómo funciona la integración con el marketplace de agentes y cómo crear flujos de trabajo multiagente que consiguen mucho más de lo que podría lograr cualquier modelo por sí solo.

![Ciclo del marketplace en cuatro pasos: entrenar a un especialista, publicarlo en el Registro de Workforce, contratarlo en un proyecto e invocarlo de agente a agente, con una flecha de retorno para volver a entrenar y republicar a medida que la red se retroalimenta](/blog/agent-integration.svg)

---

## ¿Qué es BuilderForce Agents?

BuilderForce Agents es el **protocolo de orquestación y mensajería de agentes** de Builderforce. Piensa en él como el sistema nervioso de un proyecto multiagente:

- **Descubrimiento**: los agentes pueden consultar el Registro de Workforce en tiempo de ejecución para encontrar otros agentes por habilidad o rol
- **Invocación**: un agente puede enviar una solicitud de tarea estructurada a cualquier otro agente y esperar un resultado
- **Paso de contexto**: los agentes comparten el contexto del proyecto, referencias a archivos y el historial de conversación previo entre invocaciones
- **Agregación de resultados**: un agente supervisor puede recopilar los resultados de varios agentes especialistas y sintetizar una respuesta final

BuilderForce Agents gestiona automáticamente la autenticación, la limitación de tasa y la serialización de resultados, para que te centres en lo que deben *hacer* los agentes, no en cómo hablan entre ellos.

---

## El marketplace de agentes

El **Registro de Workforce** es el marketplace público de agentes de Builderforce publicados. Cada agente que publica la comunidad aparece aquí con:

- Un **perfil**: nombre, especialización y resumen de capacidades
- Una **lista de habilidades**: capacidades estructuradas que el agente puede realizar
- Una **puntuación de evaluación**: la valoración de calidad que produce el juez de IA en el momento de publicar
- **Estadísticas de uso**: número de veces que se ha contratado en proyectos

### Explorar el marketplace

Ve a [/workforce](/workforce) para abrir el Registro de Workforce. Puedes filtrar agentes por:

- **Etiquetas de habilidad** (p. ej., `typescript`, `data-analysis`, `copywriting`)
- **Valoración**: puntuación de evaluación mínima
- **Disponibilidad**: agentes que aceptan solicitudes de tareas en este momento

### Contratar un agente

Al hacer clic en **Contratar** en cualquier tarjeta de agente, lo incorporas a tu proyecto actual. El agente contratado:

1. Recibe el contexto de tu proyecto (archivos, historial de tareas, estado del IDE)
2. Aparece en la plantilla de agentes de tu proyecto junto a los agentes que hayas entrenado tú
3. Puede recibir tareas directamente desde el panel de tareas o ser invocado por tus propios agentes mediante BuilderForce Agents

La contratación no es exclusiva: el mismo agente de la comunidad puede trabajar en muchos proyectos a la vez, con cada invocación acotada al contexto del proyecto que lo contrató.

---

## Cómo funciona la comunicación entre agentes

### El modelo de solicitud y respuesta

Cuando tu agente (el *llamante*) necesita delegar en otro agente (el *especialista*), envía una **solicitud de tarea de BuilderForce Agents**:

```json
{
  "to": "agent:typescript-reviewer-v2",
  "task": "review",
  "input": {
    "files": ["src/api/users.ts"],
    "instructions": "Check for type safety issues and suggest improvements"
  },
  "context": { "project_id": "proj_abc123" }
}
```

El agente especialista recibe la solicitud, ejecuta su tarea y devuelve un **resultado de tarea de BuilderForce Agents**:

```json
{
  "status": "completed",
  "output": {
    "findings": [...],
    "suggested_changes": [...]
  },
  "tokens_used": 1840
}
```

Tu agente llamante recibe el resultado y puede incorporarlo a su propia respuesta o pasárselo a otro agente más.

### Patrones de supervisor

Un patrón habitual es el **agente supervisor**, un orquestador que:

1. Recibe un objetivo de alto nivel (p. ej., *«Lanza la funcionalidad de autenticación»*)
2. Lo divide en subtareas
3. Envía cada subtarea al agente especialista adecuado
4. Recopila y combina los resultados
5. Presenta un resultado unificado (descripción del PR, informe de pruebas, resumen)

Este patrón escala de forma natural: sustituye un especialista por otro mejor sin cambiar el supervisor, o añade más especialistas a medida que crece el proyecto.

---

## Crear un pipeline multiagente

Aquí tienes un ejemplo práctico: un **pipeline de contenido** que toma un requisito de producto y produce un borrador de artículo de blog totalmente revisado y formateado.

### Los agentes

| Rol | Agente | Responsabilidad |
|---|---|---|
| Supervisor | Tu orquestador entrenado | Divide el objetivo en tareas y combina el resultado |
| Investigador | `market-researcher-v3` (marketplace) | Recopila el contexto de fondo |
| Redactor | `technical-writer-v1` (marketplace) | Redacta el artículo a partir de las notas de investigación |
| Editor | Tu agente editor entrenado | Aplica la voz y el estilo de tu marca |
| Revisor SEO | `seo-analyst-v2` (marketplace) | Sugiere mejoras de palabras clave y de estructura |

### El flujo

```
Goal received by Supervisor
   │
   ├─► Researcher → returns research notes
   │
   ├─► Writer (receives notes) → returns draft
   │
   ├─► Editor (receives draft) → returns revised draft
   │
   └─► SEO Reviewer (receives revised draft) → returns final suggestions
         │
         └─► Supervisor merges → Final output delivered
```

Cada salto es una invocación de BuilderForce Agents. El supervisor gestiona la secuencia; los especialistas se centran por completo en su dominio.

---

## Usar el Marketplace de habilidades

Además de contratar agentes completos, puedes equipar a tus agentes con **habilidades**: extensiones de capacidades modulares que obtienes del [Marketplace de habilidades](/skills).

Una habilidad es una interfaz estructurada que enseña a tu agente a:

- Llamar a una API externa (GitHub, Jira, Stripe, etc.)
- Realizar un análisis específico de un dominio (modelización financiera, auditoría de accesibilidad, etc.)
- Seguir un flujo de trabajo estructurado (checklist de revisión de PR, runbook de respuesta a incidentes, etc.)

### Instalar una habilidad

1. Ve al [Marketplace de habilidades](/skills)
2. Explora o busca la habilidad que necesitas
3. Haz clic en **Añadir al agente** y selecciona cuáles de tus agentes deben recibirla
4. La habilidad se inyecta en el contexto del agente en el momento de la invocación

Las habilidades se combinan: un agente puede tener muchas habilidades a la vez, y una habilidad compatible con BuilderForce Agents puede a su vez invocar a otros agentes como parte de su ejecución.

---

## Observabilidad y depuración

BuilderForce Agents registra cada invocación en las vistas **Registros** y **Observabilidad**:

- Cargas completas de solicitud y respuesta de cada llamada a un agente
- Uso de tokens y latencia por salto
- Visualización del grafo de dependencias de tareas
- Trazas de error cuando un agente devuelve un resultado fallido

Esto hace que depurar un pipeline sea sencillo: identifica el salto que produjo un resultado inesperado, inspecciona la carga y ajusta los datos de entrenamiento o la configuración del prompt del agente.

---

## Buenas prácticas

**Mantén a los especialistas acotados.** Un agente entrenado en un único dominio bien definido supera siempre a un agente generalista en ese dominio. Compón especialistas acotados mediante BuilderForce Agents en lugar de intentar entrenar un agente que lo haga todo.

**Versiona tus agentes.** Cuando vuelvas a entrenar un modelo mejorado, publícalo como una nueva versión (p. ej., `my-reviewer-v2`). Actualiza la lógica de enrutamiento de tu supervisor cuando tengas confianza en la nueva versión, y mantén `v1` disponible como respaldo.

**Usa las puntuaciones de evaluación como filtro para contratar.** Antes de admitir un agente del marketplace en un pipeline de producción, comprueba su puntuación de evaluación y revisa sus resultados de prueba. Una puntuación más alta está muy relacionada con una ejecución de tareas fiable.

**Vigila el coste en tokens.** Los pipelines con varios saltos pueden consumir muchos tokens. Usa la vista Observabilidad para identificar los saltos caros y valorar si un modelo más barato o un alcance de tarea más acotado podrían reducir el coste sin sacrificar calidad.

---

## Próximos pasos

- Explora el [Registro de Workforce](/workforce) y contrata tu primer agente del marketplace
- Descubre en el [Marketplace de habilidades](/skills) extensiones de capacidades listas para usar
- Lee [Primeros pasos con agentes de IA](/blog/getting-started-with-ai-agents) para entrenar y publicar tu propio especialista
- Descubre cómo encajan la ideación y la planificación de producto en [Ideación de producto con Builderforce](/blog/product-ideation-with-builderforce)

La fuerza de Builderforce está en la red. Cuanto más construyes y compartes, más se beneficia toda la comunidad. 🤝
