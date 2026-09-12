Cuando un agente de IA ejecuta una tarea, pasan muchas cosas. Planifica, invoca herramientas, escribe archivos, delega en otros agentes, informa de vuelta. Saber *qué* pasó, *cuándo*, *qué agente* lo hizo y *si salió bien* es la diferencia entre un sistema en el que confías y uno al que temes.

Builderforce te da esa visibilidad mediante una pila por capas: **tareas**, **ejecuciones**, **telemetría de flujos de trabajo** y la **línea temporal del portal en tiempo real**. Este artículo recorre cada capa.

![Ejecución de tareas y observabilidad: una ejecución pasa por los estados pendiente, enviada, en ejecución y completada o fallida, con sus spans por herramienta dispuestos en una línea temporal y la llamada fallida resaltada, y mosaicos agregados del panel con totales, completadas, fallidas, duración y tokens](/blog/task-observability.svg)

---

## El modelo de datos

Entender qué sigue Builderforce implica entender cuatro conceptos relacionados:

| Concepto | Qué representa |
|---|---|
| **Tarea** | Una unidad de trabajo definida en un proyecto (un elemento del backlog, una funcionalidad, una corrección de errores) |
| **Ejecución** | Un intento concreto de ejecutar esa tarea en una instancia concreta de BuilderForce Agents |
| **Flujo de trabajo** | Una orquestación estructurada de varios pasos que un agente de BuilderForce Agents ejecuta para completar una tarea |
| **Tarea del flujo de trabajo** | Un paso individual dentro de un flujo de trabajo (p. ej., el paso «coder» o el paso «reviewer») |

Una misma **tarea** puede tener varias **ejecuciones** a lo largo del tiempo (reintentos, nuevas ejecuciones). Cada ejecución está asociada a exactamente un **flujo de trabajo** cuando el orquestador de BuilderForce Agents ejecuta un DAG para completarla.

---

## Ciclo de vida de la tarea

Las tareas avanzan por una progresión de estados definida:

```
backlog → todo → ready → in_progress → in_review → done
                                   └─► blocked
```

Gestionas las tareas desde la página [Tareas](/tasks). Cada tarea registra:

- **Prioridad** (`low`, `medium`, `high`, `urgent`): determina si se activa automáticamente un punto de aprobación
- **AgentHost asignado**: qué instancia de BuilderForce Agents debe ejecutarla
- **Persona**: qué rol de agente debe liderar la ejecución
- **URL del PR de GitHub**: se vincula automáticamente en cuanto un agentHost crea un pull request

---

## Ciclo de vida de la ejecución

Cuando se envía una tarea para su ejecución (mediante `POST /api/runtime/executions` o desde el portal), se crea un **registro de ejecución** y se envía un evento `task.assign` al agentHost a través del relay.

La ejecución sigue esta máquina de estados:

```
pending → submitted → running → completed
                    └─► failed
                    └─► cancelled
```

El agentHost informa automáticamente a Builderforce de cada transición:

- **running**: se informa en cuanto el agente recibe la tarea y empieza a procesarla
- **completed**: se informa cuando la sesión de chat del agente produce una respuesta final
- **failed**: se informa cuando la sesión termina con un error

Puedes seguir estas transiciones en tiempo real en la página [Línea temporal](/timeline): la tarjeta de la ejecución se actualiza en vivo a medida que el agentHost informa del estado.

---

## Telemetría de flujos de trabajo

Cuando BuilderForce Agents ejecuta un flujo de trabajo orquestado para completar una tarea, emite **spans de telemetría estructurados**: uno por flujo de trabajo y uno por paso de tarea. Estos spans aparecen en dos lugares:

### 1. JSONL local (en el agentHost)

```bash
# Every span is written locally on the agentHost
cat .builderforce/telemetry/2026-03-11.jsonl | jq .

# Find slow tasks
cat .builderforce/telemetry/2026-03-11.jsonl | \
  jq 'select(.kind == "task.complete") | {role: .agentRole, ms: .durationMs}' | \
  sort -t: -k2 -n
```

### 2. Portal de Builderforce (en tiempo real)

Los mismos spans se reenvían al portal a medida que se emiten:

- `workflow.start` → crea un registro de flujo de trabajo en la página [Flujos de trabajo](/workflows)
- `task.start` → añade un paso de tarea con `status: running`
- `task.complete` / `task.fail` → actualiza el paso con el estado final y la duración
- `workflow.complete` / `workflow.fail` → cierra el registro del flujo de trabajo

Esto significa que la página Flujos de trabajo es una **vista en vivo** de lo que está haciendo ahora mismo cada agentHost conectado. Sin consultas manuales.

---

## La página Flujos de trabajo

Ve a [/workflows](/workflows) para ver todos los flujos de trabajo de tu flota.

Puedes filtrar por:

- **Estado**: en ejecución, completado, fallido, pendiente
- **Tipo de flujo de trabajo**: feature, bugfix, refactor, planning, adversarial, custom
- **AgentHost**: filtra por una máquina concreta

Cada entrada de flujo de trabajo se despliega para mostrar su DAG de tareas: los pasos individuales con el rol del agente, la descripción, la duración y el estado. Los pasos fallidos muestran el mensaje de error en línea.

---

## El panel de ejecuciones

[/observability](/observability) (o el enlace al panel desde cualquier página de proyecto) muestra estadísticas agregadas:

| Métrica | Qué mide |
|---|---|
| Ejecuciones totales | Todas las ejecuciones en la ventana de tiempo seleccionada |
| Completadas | Ejecuciones terminadas con éxito |
| Fallidas | Ejecuciones que terminaron con error |
| En ejecución | Activas en este momento |
| Duración media | Tiempo medio de ejecución (solo ejecuciones completadas) |
| Uso de tokens | Total de tokens consumidos en todas las ejecuciones |

El panel desglosa los datos por proyecto, por agentHost y por rol de agente, para que veas qué partes de tu sistema consumen más recursos o fallan más a menudo.

---

## Eventos de auditoría de herramientas

Cada llamada a una herramienta que hace un agente queda registrada en el **registro de auditoría de herramientas**, que puedes consultar desde [Registros](/logs):

```
timestamp   | agentHost     | tool         | duration | status
2026-03-11T | agentHost-7   | read_file    | 42ms     | success
2026-03-11T | agentHost-7   | bash         | 1.2s     | success
2026-03-11T | agentHost-7   | write_file   | 38ms     | success
2026-03-11T | agentHost-7   | bash         | 3.4s     | error
```

Cada evento incluye los argumentos de entrada completos y el resultado, para que puedas rastrear exactamente qué hizo el agente en cada paso. Es la capa de depuración más profunda: cuando una ejecución falla, el registro de auditoría de herramientas te dice qué llamada concreta la causó.

---

## Streaming de ejecuciones en tiempo real

Para las ejecuciones que importan ahora mismo, puedes suscribirte a actualizaciones en vivo mediante el stream WebSocket en `GET /api/runtime/executions/:id/stream`. Es lo que usa internamente la tarjeta de ejecución en vivo del portal: cada transición de estado y cada evento de telemetría se envían en el momento en que llegan del agentHost.

El stream entrega:

- Eventos `status_change` a medida que la ejecución pasa por los estados
- Eventos `done` cuando la ejecución se completa o falla
- Instantáneas del uso de tokens de la sesión en curso

---

## Especificaciones: donde empieza la ejecución

La primitiva de planificación de más alto nivel en Builderforce es la **especificación** (spec): un documento de planificación estructurado que vive en [/tasks](/tasks), en el panel de planificación.

Una especificación avanza por:

```
draft → reviewed → approved → in_progress → done
```

Cada especificación contiene:

- **Objetivo**: el propósito, en lenguaje llano
- **PRD**: el documento de requisitos de producto (redactado con ayuda de la IA desde [Brainstorm](/brainstorm))
- **Especificación de arquitectura**: diseño técnico, generado o editado
- **Lista de tareas**: un array JSON de tareas derivadas de la especificación, listas para crearse en el tablero de tareas

Cuando una especificación pasa a `approved`, la lista de tareas se convierte en un conjunto de tareas ejecutables. A partir de ahí, toma el relevo el ciclo de vida de ejecución descrito arriba.

---

## Buenas prácticas

**Asigna agentHosts a las tareas de forma explícita** cuando tengas una flota. Una tarea sin asignar se difunde a todos los agentHosts conectados: está bien para explorar, pero genera ruido en producción. Fija las tareas al agentHost con el espacio de trabajo y el modelo adecuados.

**Usa los tipos de flujo de trabajo con intención.** Un flujo `bugfix` pasa por bug-analyzer → coder → test-generator. Un flujo `feature` va planner → architect → coder → reviewer → tester. Elegir el tipo adecuado significa que se invocan los roles de agente correctos en el orden correcto sin orquestación personalizada.

**Consulta primero el registro de auditoría al depurar.** Antes de volver a lanzar una ejecución fallida, mira los eventos de auditoría de herramientas de esa ejecución. Normalmente el fallo es una sola llamada a una herramienta: un comando bash que devolvió un código de salida distinto de cero o una escritura de archivo que chocó con un error de permisos.

---

## Próximos pasos

- Consulta tus ejecuciones actuales en la [Línea temporal](/timeline)
- Revisa las aprobaciones pendientes de las tareas de alta prioridad en [Aprobaciones de Workforce](/workforce?tab=approvals)
- Explora la página [Flujos de trabajo](/workflows) para ver qué están orquestando ahora mismo tus agentHosts
- Lee [Puntos de aprobación y supervisión humana](/blog/approval-gates-and-human-oversight) para saber cómo someter a aprobación los pasos de ejecución de alto riesgo
