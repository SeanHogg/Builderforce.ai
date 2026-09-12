La mayoría de las herramientas de programación con IA empiezan por el código. Dan por hecho que ya sabes qué construir. Builderforce no está de acuerdo.

El mejor trabajo de ingeniería empieza pensando con claridad: cuál es el problema, cómo es la solución a nivel de arquitectura y cuáles son las unidades de trabajo concretas necesarias para llegar a ella. Builderforce te ofrece herramientas asistidas por IA para cada etapa y una **especificación** estructurada que lleva tu razonamiento hasta los agentes que lo ejecutan.

![La pila de planificación, que se estrecha desde la idea hasta el PRD, la especificación de arquitectura, una lista de tareas en JSON y las tareas ejecutables por agentes](/blog/specs-planning.svg)

---

## La pila de planificación

Builderforce organiza la planificación en cuatro capas, cada una de las cuales alimenta a la siguiente:

```
Idea / goal (free text)
    │
    ▼
PRD (Product Requirements Document)  ◄── AI-assisted in Brainstorm
    │
    ▼
Architecture Spec                    ◄── AI-assisted in Brainstorm
    │
    ▼
Task list (JSON)                     ◄── AI-generated from spec
    │
    ▼
Executable tasks                     ──► Agent execution on BuilderForce Agents
```

La especificación es el contenedor que reúne las cuatro capas en un solo lugar.

---

## Empieza con Lluvia de ideas

[/brainstorm](/brainstorm) es el entorno de ideación: una interfaz de chat asistida por IA pensada específicamente para reflexionar sobre el producto, no para programar.

Abre Lluvia de ideas y empieza con un objetivo:

> «Quiero crear una función que permita a los usuarios exportar la actividad de su proyecto como un informe en PDF.»

El asistente de IA te ayuda a:

- **Afinar el objetivo**: acotarlo, cuestionar supuestos, identificar casos límite
- **Redactar el PRD**: historias de usuario, criterios de aceptación, requisitos no funcionales, elementos fuera de alcance
- **Generar la especificación de arquitectura**: desglose de componentes, cambios en el modelo de datos, diseño de la API, consideraciones de migración

Cuando estés satisfecho con el resultado, haz clic en **Guardar como especificación** para crear un registro de especificación vinculado a tu proyecto.

---

## El registro de especificación

Una especificación vive en [/tasks](/tasks) → pestaña **Especificaciones**. Cada especificación tiene un ciclo de vida de estados:

```
draft → reviewed → approved → in_progress → done
```

La especificación almacena:

| Campo | Contenido |
|---|---|
| **Objetivo** | Una frase que indica qué consigue esta especificación |
| **PRD** | Documento completo de requisitos de producto (Markdown) |
| **Especificación de arquitectura** | Documento de diseño técnico (Markdown) |
| **Lista de tareas** | Array JSON de tareas listas para el tablero |
| **Estado** | Etapa actual en el flujo de aprobación |
| **agentHost vinculado** | Qué instancia de BuilderForce Agents la ejecutará |
| **Proyecto vinculado** | El proyecto al que pertenece esta especificación |

---

## Generar la lista de tareas

Una vez redactados el PRD y la especificación de arquitectura, Builderforce (o un asistente de IA en el editor de especificaciones) puede generar la **lista de tareas**: un desglose estructurado de cada pieza de trabajo necesaria para implementar la especificación.

Una entrada de la lista de tareas tiene este aspecto:

```json
{
  "title": "Add PDF export endpoint to the API",
  "description": "Implement POST /api/projects/:id/export/pdf that streams a generated PDF using Puppeteer",
  "priority": "medium",
  "persona": "coder",
  "dependsOn": ["Add PDF template component"]
}
```

La lista de tareas se revisa en el editor de especificaciones. Puedes añadir, eliminar y reordenar tareas, ajustar prioridades y asignar perfiles (qué rol de agente de BuilderForce Agents debe encargarse de cada tarea).

---

## Pasar al tablero de tareas

Cuando la especificación está `approved`, haz clic en **Crear tareas** para enviar la lista de tareas al tablero de [Tareas](/tasks). Cada entrada de la lista se convierte en un registro de tarea en el backlog.

A partir de ahí, las tareas siguen el ciclo de vida normal: se pueden clasificar, priorizar, asignar a agentHosts concretos y enviar a ejecución. La especificación sigue vinculada a cada tarea, así que siempre puedes rastrear cualquier tarea hasta el PRD original.

---

## Flujos de especificación

Cuando envías una especificación a ejecución (en lugar de convertirla en tareas individuales), Builderforce crea un **flujo de especificación**: una orquestación de BuilderForce Agents que trata toda la especificación como una unidad de trabajo.

El tipo de flujo de especificación `planning` ejecuta:

1. **Planificador**: lee el objetivo y el PRD de la especificación y produce un plan de ejecución detallado
2. **Arquitecto**: revisa la especificación de arquitectura y produce notas de implementación
3. **Programador**: implementa la primera ronda de cambios a partir del plan
4. **Revisor**: revisa el código frente a los criterios de aceptación de la especificación

Cada paso aparece en el portal de [Flujos](/workflows) a medida que se ejecuta. Puedes ver en tiempo real cómo los agentes avanzan por la especificación.

---

## Colaborar en las especificaciones

Las especificaciones son documentos compartidos: cualquier miembro del equipo con acceso al proyecto puede leerlas, comentarlas y editarlas. El historial de chat de Lluvia de ideas se conserva junto a la especificación, así que el razonamiento detrás de cada decisión siempre está a la vista.

Para las especificaciones que afectan a sistemas en producción, añade un **revisor** antes de aprobarlas. El revisor recibe una notificación y su aprobación hace pasar la especificación de `reviewed` a `approved`. Es un control humano ligero antes de empezar el trabajo, independiente de los puntos de aprobación a nivel de ejecución que se activan durante el trabajo de los agentes.

---

## Integración con el control de versiones

Cuando las tareas de una especificación se completan y se crea una pull request, puedes vincular la PR a la especificación:

1. Abre la tarea que generó la PR
2. Pega la URL de la PR de GitHub en el campo **URL de la PR**
3. El estado de la especificación se actualiza automáticamente cuando se fusiona la PR

Si tienes configurada una integración de control de versiones con GitHub (Ajustes → Control de versiones), BuilderForce Agents puede crear y vincular las PR automáticamente, sin el paso manual.

---

## Gobernanza y restricciones

El documento de arquitectura de la especificación es también el lugar adecuado para registrar la **gobernanza del proyecto**: las reglas que tus agentes deben seguir al trabajar en este proyecto. Los documentos de gobernanza se sincronizan con el `.builderforce/context.yaml` del agentHost como parte del contexto de asignación, de modo que los agentes los cargan al arrancar y los siguen durante toda la ejecución.

Ejemplos de gobernanza:

- «Todo cambio en la base de datos debe incluir un archivo de migración»
- «Nada de escrituras directas en la tabla `users`: usa el UserService»
- «Cada PR debe incluir tests para la funcionalidad nueva»
- «No uses nunca `eval()` ni el constructor `Function()`»

Los agentes entrenados con las habilidades adecuadas interpretarán estas restricciones con naturalidad y las aplicarán sin necesidad de más instrucciones.

---

## Buenas prácticas

**Escribe el PRD antes que la especificación de arquitectura.** Es tentador saltar directamente a «cómo construirlo», pero un PRD claro te obliga a responder antes «qué problema estamos resolviendo». Las decisiones de arquitectura que parten de un planteamiento claro del problema tienen muchas menos probabilidades de ser erróneas.

**Mantén las tareas pequeñas y atómicas.** Una tarea que a un ingeniero humano experto le lleva 4 horas es del tamaño adecuado para un agente. Las tareas más grandes tienden a producir implementaciones dispersas, difíciles de revisar y de revertir.

**Usa perfiles en la lista de tareas.** Una tarea `coder` y una tarea `reviewer` para la misma funcionalidad garantizan que haya tanto implementación como revisión, y no solo una de las dos. La lista de tareas de la especificación es el lugar adecuado para imponer esa disciplina.

**Revisa la especificación de arquitectura antes de aprobarla.** Los agentes son notablemente buenos implementando lo que describes. Si la especificación de arquitectura está mal, la implementación reproducirá el error con total fidelidad.

---

## Próximos pasos

- Abre [Lluvia de ideas](/brainstorm) y redacta con ayuda de la IA la especificación de tu próxima funcionalidad
- Ve a [Tareas](/tasks) → Especificaciones para ver tus documentos de planificación actuales
- Lee [Ejecución de tareas y observabilidad](/blog/task-execution-and-observability) para entender qué ocurre cuando las tareas se crean y se asignan a los agentes
- Consulta [Puntos de aprobación](/blog/approval-gates-and-human-oversight) para ver cómo añadir controles humanos en la aprobación de la especificación y en la ejecución de las tareas
