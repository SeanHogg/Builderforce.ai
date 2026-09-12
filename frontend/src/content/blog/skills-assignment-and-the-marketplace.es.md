Las capacidades integradas de un agente son su punto de partida. Las habilidades son la forma de ampliarlas: inyectar conocimiento del dominio, integraciones con API, flujos de trabajo estructurados y comportamiento especializado sin volver a entrenar el modelo subyacente.

Builderforce tiene dos formas de llevar habilidades a tus agentes: el **Marketplace de habilidades** (publicadas por la comunidad: exploras y asignas) y las **habilidades personalizadas** (las creas tú y son tuyas). Ambas siguen el mismo modelo de asignación y ambas se cargan automáticamente en tus instancias de BuilderForce Agents al arrancar.

![El sistema de habilidades: explora o publica habilidades en el marketplace, asígnalas a nivel de tenant, agentHost, proyecto o tarea, donde prevalece la tarea, y el conjunto combinado se carga en el registro de habilidades de cada agentHost al arrancar](/blog/skills-marketplace.svg)

---

## ¿Qué es una habilidad?

Una habilidad es una extensión de capacidades estructurada. En su forma más simple, es un **fragmento de prompt de sistema** que da a un agente conocimientos o instrucciones concretas. Las habilidades más sofisticadas incluyen:

- **Definiciones de herramientas**: firmas de funciones estructuradas que el agente puede invocar (p. ej., una habilidad de la API de GitHub que define `create_pr`, `add_comment`, `merge_branch`)
- **Plantillas de flujo de trabajo**: runbooks paso a paso que el agente sigue (p. ej., una habilidad de respuesta a incidentes que define el ciclo triaje → diagnóstico → corrección → comunicación)
- **Conocimiento del dominio**: material de referencia integrado que el agente usa en tiempo de inferencia (p. ej., una habilidad `typescript-strict` que integra las convenciones de TypeScript de tu equipo)

Cuando se carga una habilidad, el agente se comporta como si ya supiera todo lo que contiene. Sin necesidad de prompts.

---

## El Marketplace de habilidades

Ve a [/skills](/skills) para explorar las habilidades que ha publicado la comunidad.

Cada ficha de habilidad muestra:

| Campo | Descripción |
|---|---|
| **Nombre y slug** | Identificador único que se usa para la asignación (`org/skill-name`) |
| **Descripción** | Qué le enseña la habilidad al agente |
| **Categoría** | Etiqueta de dominio general (desarrollo, operaciones, marketing, etc.) |
| **Etiquetas** | Etiquetas de capacidad detalladas para filtrar |
| **Versión** | Versión publicada actual |
| **Descargas** | Cuántas veces se ha asignado |
| **Me gusta** | Señal de calidad de la comunidad |
| **Autor** | Quién la ha publicado |

### Explorar y filtrar

La búsqueda del marketplace admite:

- **Texto completo**: busca en el nombre, la descripción y las etiquetas
- **Filtro por categoría**: acota por dominio
- **Filtro por etiqueta**: encuentra habilidades con etiquetas de capacidad concretas
- **Ordenar por**: descargas, me gusta o más recientes

### Publicar una habilidad

Si has creado una habilidad para tus agentes que podría servir a otros equipos:

1. Ve a [/skills](/skills) → **Publicar habilidad**
2. Rellena el nombre, el slug, la descripción, la categoría y las etiquetas
3. Pega la definición de tu habilidad (fragmento de prompt de sistema, esquemas de herramientas o plantilla de flujo de trabajo)
4. Haz clic en **Publicar**

Las habilidades publicadas aparecen de inmediato en las búsquedas del marketplace. Puedes actualizar los metadatos y el contenido en cualquier momento, y las versiones publicadas quedan registradas para que quien las use pueda fijar una versión concreta.

---

## Asignar habilidades

Una habilidad no hace nada hasta que se **asigna**, es decir, hasta que se vincula a los agentes o agentHosts que deben usarla. Builderforce tiene un modelo de asignación de dos niveles.

### Asignaciones a nivel de tenant

Una **asignación a nivel de tenant** pone una habilidad a disposición de **todos los agentHosts** de tu organización. Úsala para las habilidades que todo agente debería tener: tus estándares de código, tus convenciones de API, las herramientas propias de tu empresa.

Gestiona las asignaciones de tenant desde [/skills](/skills) → pestaña **Asignaciones de tenant**:

1. Busca o pega el slug de la habilidad
2. Haz clic en **Asignar a todos los AgentHosts**
3. La habilidad aparece en el registro de habilidades de cada agentHost en su siguiente arranque

### Asignaciones a nivel de agentHost

Una **asignación a nivel de agentHost** sustituye o añade una habilidad para una instancia concreta de BuilderForce Agents. Úsala para equipar a un agentHost especializado: tu `frontend-workstation` podría tener habilidades de React y Tailwind que ningún otro agentHost necesita.

Gestiona las asignaciones de agentHost desde el panel de detalle del agentHost → pestaña **Habilidades**:

1. Haz clic en **Asignar habilidad**
2. Busca y selecciona la habilidad
3. La asignación entra en vigor en el siguiente arranque del agentHost

Las asignaciones a nivel de agentHost **prevalecen** sobre las de nivel de tenant cuando el mismo slug de habilidad aparece en ambos niveles: gana la configuración específica del agentHost.

---

## Cómo se cargan las habilidades al arrancar

Cuando BuilderForce Agents arranca y hay una conexión con Builderforce configurada, obtiene la lista combinada de habilidades:

```
GET /api/agent-hosts/:id/skills
```

Esto devuelve la unión de:
1. Todas las asignaciones de habilidades a nivel de tenant
2. Todas las sustituciones a nivel de agentHost para este agentHost concreto

El conjunto combinado se carga en el **registro de habilidades** local del agentHost y está disponible para los agentes durante toda la vida de ese proceso. Si añades una nueva asignación de habilidad en el portal, el agentHost la recoge la próxima vez que se reinicie.

Para comprobar qué habilidades ha cargado un agentHost en ejecución, mira sus registros de arranque:

```
[skill-registry] loaded 4 skill(s): typescript-strict, github-api, test-runner, our-coding-standards
```

O consulta el portal desde la pestaña **Habilidades** del agentHost, que muestra el estado de asignación en vivo.

---

## Asignaciones de artefactos: el modelo de alcance completo

Las habilidades son un tipo de **artefacto**. Builderforce usa un sistema unificado de **asignación de artefactos** que funciona para habilidades, personas y contenido en cualquier nivel de alcance:

| Alcance | Se aplica a |
|---|---|
| `tenant` | Todos los agentHosts y agentes de la organización |
| `agentHost` | Una instancia concreta de BuilderForce Agents |
| `project` | Cualquier agentHost que trabaje en un proyecto concreto |
| `task` | El agente que ejecuta una tarea concreta |

La resolución del alcance sigue esta precedencia: `task > project > agentHost > tenant`. Si una tarea tiene asignada una habilidad concreta, esa asignación gana aunque la asignación a nivel de tenant diga otra cosa.

Gestiona las asignaciones de artefactos desde [/skills](/skills) → **Asignaciones de artefactos**, donde puedes asignar cualquier tipo de artefacto a cualquier alcance desde una única interfaz.

---

## Crear habilidades personalizadas

Las habilidades no son solo para el marketplace. Para herramientas internas, flujos de trabajo propios o convenciones específicas de tu empresa, crea habilidades privadas que nunca salgan de tu tenant.

Una definición de habilidad tiene tres partes:

**1. Fragmento de prompt de sistema**
```markdown
## Code Style
Always use TypeScript strict mode. Prefer `const` over `let`.
Never use `any` — use `unknown` and narrow with type guards.
All async functions must handle errors explicitly.
```

**2. Definiciones de herramientas (opcional)**
```json
{
  "name": "create_github_pr",
  "description": "Create a pull request on GitHub",
  "input_schema": {
    "type": "object",
    "properties": {
      "title": { "type": "string" },
      "branch": { "type": "string" },
      "base": { "type": "string", "default": "main" },
      "body": { "type": "string" }
    },
    "required": ["title", "branch"]
  }
}
```

**3. Metadatos**
```json
{
  "name": "Our TypeScript Standards",
  "slug": "acme/typescript-standards",
  "category": "development",
  "tags": ["typescript", "code-style", "internal"],
  "version": "1.0.0"
}
```

Las habilidades privadas (publicadas sin el indicador `public`) solo son visibles para tu tenant.

---

## Habilidades activadas por cron

Las habilidades también pueden respaldar **tareas programadas**. Si tienes una habilidad que genera un resumen diario de la reunión diaria (stand-up), una auditoría semanal de dependencias o una ejecución nocturna de pruebas, combínala con una tarea cron desde el [Panel](/dashboard) → pestaña **Cron**:

```
Schedule: 0 9 * * 1-5   (9am Monday–Friday)
Task: "Run the daily standup summary skill for project X"
```

El sondeador de cron del agentHost asignado obtiene la programación al arrancar y ejecuta la tarea en el momento adecuado. Sin necesidad de infraestructura de cron externa.

---

## Buenas prácticas

**Una habilidad, una responsabilidad.** Una habilidad que abarca TypeScript, pruebas, GitHub y despliegue es difícil de mantener y de depurar. Divídela en habilidades enfocadas (`typescript-style`, `jest-patterns`, `github-actions`) y compónlas mediante asignaciones.

**Versiona las habilidades antes de actualizarlas.** Si una actualización va a cambiar el comportamiento del agente, sube la versión antes de publicar. Quienes tengan fijada la `v1.2` no se ven afectados; quienes quieran el nuevo comportamiento actualizan su asignación de forma explícita.

**Prueba las habilidades de forma aislada antes de asignarlas a todo el tenant.** Asigna primero una habilidad nueva a un solo agentHost, ejecuta unas cuantas tareas y revisa el resultado. Cuando tengas confianza, promuévela al nivel de tenant.

**Usa personas junto a las habilidades.** Una habilidad enseña conocimiento; una persona da forma a la voz y al estilo de decisión. La combinación —un agentHost con tu habilidad de TypeScript y tu persona de «ingeniero sénior»— produce resultados más coherentes y fieles a tu marca que cualquiera de las dos por separado.

---

## Próximos pasos

- Explora el [Marketplace de habilidades](/skills) y asigna tu primera habilidad de la comunidad
- Lee [Orquestación multiagente](/blog/multi-agent-orchestration) para ver cómo encajan en un flujo de trabajo los agentHosts equipados con habilidades
- Explora [Gestión de flotas](/blog/fleet-management-and-agentHost-routing) para entender cómo se combinan las habilidades con las declaraciones de capacidades a nivel de agentHost
