Los agentes autónomos son potentes. Y eso es exactamente lo que los hace peligrosos sin las salvaguardas adecuadas. Un agente que puede subir código, modificar la configuración de producción o enviar mensajes en tu nombre es extraordinariamente útil… hasta que hace algo que no pretendías.

El sistema de **puntos de aprobación** de Builderforce.ai resuelve esto a nivel de infraestructura. Tú defines qué tipos de acción necesitan la validación de una persona; la plataforma bloquea la ejecución hasta que un responsable aprueba o rechaza; el agente solo continúa cuando la decisión queda registrada. Todo el ciclo queda auditado.

![Diagrama de flujo de un punto de aprobación: un agente que ejecuta una tarea llega a un punto que bloquea la ejecución mediante POST /api/approvals, un responsable aprueba, rechaza o deja que expire, y cada resultado se registra en un historial de auditoría inmutable](/blog/approval-gates.svg)

---

## Cómo funcionan los puntos de aprobación

En el flujo participan tres actores: el **agente** (que se ejecuta dentro de BuilderForce Agents), el **portal de Builderforce** (donde la aprobación se presenta a una persona) y el **responsable** (un miembro del equipo con el rol `MANAGER` o superior).

```
Agent runs a task
    │
    └─► "This action requires approval"
            │
            ▼
    POST /api/approvals ──────────────────────────────────────┐
            │                                                  │
            ▼                                                  ▼
    Agent suspends execution              Portal notifies manager
    (awaiting decision)                   via dashboard + relay push
            │                                                  │
            └──────────────── Manager approves/rejects ────────┘
                                          │
                             approval.decision pushed to agentHost
                                          │
                               ┌──────────▼──────────┐
                               │ approved → continue  │
                               │ rejected → abort     │
                               └──────────────────────┘
```

La propiedad clave: **la ejecución queda bloqueada de verdad**. El agente no continúa, no reintenta ni caduca en silencio. Espera —hasta un tiempo límite configurable— una decisión real de una persona real.

---

## La página de aprobaciones

Ve a [aprobaciones de Plantilla](/workforce?tab=approvals) para ver los puntos pendientes, aprobados y rechazados de tu equipo.

Cada solicitud de aprobación muestra:

| Campo | Descripción |
|---|---|
| **Tipo de acción** | Lo que el agente intentaba hacer (`git.push`, `deploy`, `task.execution`, etc.) |
| **Descripción** | El motivo, en lenguaje llano, que dio el agente |
| **Solicitado por** | Qué instancia de BuilderForce Agents envió la solicitud |
| **Solicitado el** | Fecha y hora de la solicitud |
| **Expira el** | Cuándo caducará automáticamente la solicitud si nadie responde |
| **Metadatos** | Contexto estructurado (ID de la tarea, prioridad, lista de archivos, coste estimado, etc.) |

Aprobar o rechazar requiere un solo clic. Opcionalmente puedes añadir una **nota de revisión**, que se registra junto a la decisión y es visible en el registro de auditoría.

---

## Qué activa un punto de aprobación

Hay dos orígenes:

### 1. Puntos automáticos (impuestos por la plataforma)

El entorno de ejecución de Builderforce evalúa automáticamente un punto de aprobación cuando se envía una tarea a ejecución si:

- La **prioridad de la tarea es `high` o `urgent`**

Es la red de seguridad por defecto: las tareas de alto riesgo siempre pasan por la revisión de una persona antes de que un agente empiece a ejecutarlas.

### 2. Puntos explícitos (solicitados por el agente)

Los agentes de BuilderForce Agents pueden solicitar aprobación en cualquier momento de la ejecución llamando a `requestApproval()`:

```typescript
import { requestApproval } from "@builderforce/approval-gate";

const decision = await requestApproval({
  actionType: "git.push",
  description: "Push 42 changed files to the main branch",
  metadata: {
    files: changedFiles,
    branch: "main",
    estimatedRisk: "high",
  },
  timeoutMs: 10 * 60 * 1000, // 10 minute window
});

if (decision !== "approved") {
  throw new Error(`Push not approved: ${decision}`);
}

await git.push("origin", "main");
```

El agente se queda suspendido en `await requestApproval(...)` hasta que:
- Un responsable aprueba → devuelve `"approved"`
- Un responsable rechaza → devuelve `"rejected"`
- Se agota el tiempo límite → devuelve `"timeout"`

Sin sondeos ni comprobaciones manuales: la decisión se envía al agentHost en el instante en que el responsable actúa.

---

## Requisitos de rol

Solo los usuarios con el rol `MANAGER` u `OWNER` pueden aprobar o rechazar puntos de aprobación. Los lectores y los desarrolladores pueden ver las aprobaciones pendientes, pero no pueden resolverlas.

Es intencionado. La autoridad para aprobar es un control de gobernanza: debe corresponder a las mismas personas que tienen acceso para desplegar, no a todo el equipo.

Puedes gestionar los roles del equipo desde [Ajustes → Miembros](/settings).

---

## Notificaciones

Cuando llega una solicitud de aprobación, el responsable la ve en tres lugares:

1. **El portal**: el indicador de [aprobaciones de Plantilla](/workforce?tab=approvals) se actualiza en la barra lateral en tiempo real
2. **El relay**: si hay una sesión de navegador abierta en la vista de chat del agentHost correspondiente, llega de inmediato un evento `approval.request`
3. **Canales de mensajería** (llegan en la fase 2): notificaciones de solicitudes de aprobación por Slack, Telegram y correo electrónico

---

## Historial de auditoría

Cada decisión de aprobación es permanente e inmutable. El [Registro de auditoría](/admin) guarda:

- Quién solicitó la aprobación (ID del agentHost)
- Quién tomó la decisión (ID de usuario)
- Cuál fue la decisión y cuándo
- La nota de revisión, si se añadió

Este es tu rastro de cumplimiento. Si un despliegue salió mal y necesitas saber quién lo aprobó y por qué, aquí es donde tienes que mirar.

---

## Tiempos límite y caducidad automática

Las solicitudes de aprobación tienen una marca de tiempo `expiresAt` opcional. Cuando una aprobación caduca:

- Su estado pasa a `expired`
- El agente en espera recibe una decisión `"timeout"`
- El agente es responsable de decidir si aborta o reintenta

El tiempo límite por defecto de BuilderForce Agents es de 10 minutos para las solicitudes de agentes interactivos. Para flujos de trabajo en segundo plano de mayor duración, puedes configurar un margen más amplio.

---

## Buenas prácticas

**Define los tipos de acción como una taxonomía.** Usa cadenas coherentes como `git.push`, `deploy.production`, `db.migrate` o `file.delete-bulk` en lugar de descripciones libres. Así el registro de auditoría se puede filtrar y más adelante podrás añadir reglas de automatización.

**Aplica puntos de aprobación según el riesgo, no la frecuencia.** No todas las acciones necesitan aprobación, solo las que tienen un radio de impacto significativo. Escribir en producción, las operaciones destructivas sobre archivos y las llamadas a API externas que cuestan dinero o envían comunicaciones son puntos de aprobación naturales.

**Mantén las aprobaciones pequeñas.** Una solicitud de aprobación debe describir una sola decisión. «Subir estos 42 archivos» es algo sobre lo que se puede actuar. «Haz todo el despliegue» no lo es: divídelo en controles que un responsable pueda revisar de forma significativa.

**Fija tiempos límite realistas.** Que un agente pase 24 horas bloqueado esperando una aprobación que llega a las 9 de la mañana está bien para flujos poco urgentes. Para pipelines en vivo de cara al usuario, usa tiempos límite más cortos con un comportamiento alternativo claro.

---

## Próximos pasos

- Abre [aprobaciones de Plantilla](/workforce?tab=approvals) para ver los puntos pendientes en los agentHosts de tu equipo
- Lee [La ejecución de tareas y el portal](/blog/task-execution-and-observability) para entender cómo interactúan las aprobaciones con el ciclo de vida de la ejecución
- Consulta [Orquestación multiagente](/blog/multi-agent-orchestration) para ver patrones que combinan puntos de aprobación con flujos de trabajo de varios pasos
