Una sola instancia de BuilderForce Agents en el portátil de un desarrollador ya es potente. Una flota de diez —cada una especializada en un tipo de trabajo distinto, repartidas entre varias máquinas y enrutando las tareas a la instancia más adecuada— es algo completamente distinto.

Builderforce.ai es el plano de control de esa flota. Este artículo explica cómo registrar instancias, declarar capacidades, enrutar tareas de forma inteligente y monitorizar tu malla desde el portal.

![Enrutamiento de la flota: el enrutador de la flota puntúa una tarea entrante que declara las capacidades requeridas frente a los AgentHosts en línea y la envía al host que mejor encaja, mientras que los hosts sin conexión o con coincidencia parcial se omiten o se reservan como alternativa](/blog/fleet-routing.svg)

---

## ¿Qué es una flota de AgentHosts?

Una **flota de agentHosts** son todas las instancias de BuilderForce Agents registradas en tu tenant (organización). Cada instancia es una máquina que ejecuta el gateway de BuilderForce Agents: puede ser el portátil de un desarrollador, un servidor dedicado, un worker de CI o una VM en la nube.

En el portal de Builderforce, tu flota está visible en el [Panel](/dashboard) y en el panel de detalle de cada agentHost. Cada agentHost muestra:

- **Estado**: en línea/sin conexión (según la antigüedad del último heartbeat)
- **Perfil de la máquina**: hostname, IP, ruta del espacio de trabajo, URL del túnel
- **Visto por última vez**: cuándo envió el agentHost su último heartbeat
- **Capacidades**: lo que el agentHost declara que puede hacer
- **Proyectos asignados**: qué proyectos están vinculados a él
- **Estadísticas de uso**: consumo reciente de tokens y número de ejecuciones

---

## Registrar un nuevo AgentHost

Para añadir un agentHost a tu flota:

1. Ve a [Panel](/dashboard) → **Añadir AgentHost**
2. Dale un nombre y un slug (p. ej., `backend-server-1`)
3. Copia la clave de API generada: se muestra **una sola vez** y no se puede volver a recuperar
4. En la máquina de destino, configura:

```bash
export BUILDERFORCE_AGENTS_LINK_API_KEY=<your-api-key>
export BUILDERFORCE_AGENTS_LINK_URL=https://api.builderforce.ai
builderforce start
```

El agentHost se registra automáticamente con su primer heartbeat. Su perfil de máquina, la ruta del espacio de trabajo y los metadatos de red se rellenan a partir de la carga útil de ese primer heartbeat.

---

## Heartbeats y presencia

Un agentHost conectado envía un **heartbeat** cada 5 minutos mediante `PATCH /api/agent-hosts/:id/heartbeat`. El heartbeat actualiza:

- `lastSeenAt`: se usa para determinar si está en línea o sin conexión
- `connectedAt`: se establece con el primer heartbeat
- `capabilities`: el conjunto de capacidades declaradas (ver más abajo)
- `machineProfile`: hostname, IP, puertos, URL del túnel

Un agentHost se considera **en línea** si su `lastSeenAt` está dentro de los últimos 10 minutos. Si un agentHost se desconecta, las tareas que tiene asignadas siguen en cola: no se reenrutan automáticamente a menos que configures una alternativa.

---

## Declaraciones de capacidades

Las capacidades son el vocabulario de enrutamiento de la malla. Un agentHost declara lo que puede hacer y el portal usa esas declaraciones para enrutar cada tarea a la mejor coincidencia.

Cada agentHost declara sus capacidades en la carga útil de su heartbeat:

```json
{
  "capabilities": ["chat", "tasks", "relay", "remote-dispatch"],
  "declaredCapabilities": ["typescript", "react", "testing", "refactor"]
}
```

El primer conjunto (`capabilities`) es la superficie del protocolo de BuilderForce Agents. El segundo (`declaredCapabilities`) es tu vocabulario personalizado: las etiquetas que uses para clasificar el trabajo.

### Consultar por capacidad

Desde cualquier agentHost (o a través del portal), puedes preguntar: *«¿qué agentHost de la flota es el más adecuado para este trabajo?»*

```
GET /api/agent-hosts/fleet/route?requires=typescript,testing
```

Esto devuelve el agentHost en línea que mejor encaja con el conjunto de capacidades indicado, dando prioridad a los agentHosts que declaran todas las capacidades solicitadas.

---

## Enrutamiento inteligente con `remote:auto`

El verdadero potencial de las declaraciones de capacidades es el **enrutamiento automático** en los flujos de trabajo de BuilderForce Agents.

Cuando especificas `remote:auto[caps]` como rol de agente en un flujo de trabajo, el agentHost que despacha consulta la flota, encuentra la mejor coincidencia y le reenvía la tarea:

```yaml
# .builderforce/workflows/feature-build.yaml
steps:
  - role: planner
    description: "Break down the feature into tasks"

  - role: remote:auto[typescript,react]
    description: "Implement the UI components"

  - role: remote:auto[testing]
    description: "Write unit tests for the implementation"

  - role: reviewer
    description: "Review the complete implementation"
```

El paso `remote:auto[typescript,react]` se despacha al agentHost en línea de la flota que mejor encaje con esas dos capacidades. Si ese agentHost está ocupado, se selecciona la siguiente mejor coincidencia.

---

## Enrutamiento manual con `remote:<id>`

Para los casos en que quieras un enrutamiento determinista —por ejemplo, ejecutar siempre las tareas de frontend en una estación de trabajo concreta—, usa directamente el slug o el ID numérico del agentHost:

```
remote:frontend-workstation
remote:42
```

Esto omite la puntuación por capacidades y despacha directamente a ese agentHost. Si el agentHost está sin conexión, la tarea falla de inmediato en lugar de recurrir a una alternativa.

---

## El panel de detalle del AgentHost

Haz clic en cualquier agentHost del [Panel](/dashboard) para abrir su panel de detalle. El panel tiene varias pestañas:

### Chat
Un terminal en vivo de la sesión de chat activa del agentHost: puedes enviar tareas, ver las respuestas en streaming y observar al agente trabajando en tiempo real.

### Sesiones
El historial de todas las sesiones que se han ejecutado en este agentHost, con hora de inicio, duración y uso de tokens. Haz clic en cualquier sesión para ver su transcripción completa.

### Proyectos
Los proyectos a los que está asignado este agentHost. Desde esta pestaña puedes asignar y desasignar proyectos.

### Habilidades
Las habilidades cargadas actualmente en este agentHost: tanto las asignadas a nivel de tenant como las específicas de este agentHost. Los cambios que hagas aquí se aplican la próxima vez que se reinicie el agentHost (las habilidades se obtienen al arrancar).

### Espacio de trabajo
El directorio que este agentHost ha sincronizado con Builderforce: inventario de archivos, estado de sincronización y marca de tiempo de la última sincronización.

### Uso
Consumo de tokens por sesión, utilización de la ventana de contexto y eventos de compactación. Útil para detectar un desbordamiento de contexto antes de que se convierta en un problema.

### Depuración
El perfil de máquina sin procesar, los metadatos de red, el estado de la conexión con el relay y las cargas útiles de los últimos 20 heartbeats. Es el primer sitio donde mirar cuando un agentHost se desconecta de forma inesperada.

---

## Asignación de proyectos

Un agentHost sin un proyecto asignado no tiene contexto: no sabe qué código base, qué reglas ni qué memoria cargar. Asigna al menos un proyecto a cada agentHost:

1. Abre el panel de detalle del agentHost → pestaña **Proyectos**
2. Haz clic en **Asignar proyecto** y selecciona el proyecto
3. El agentHost obtiene el contexto de asignación actualizado en su siguiente heartbeat

Un agentHost puede estar asignado a varios proyectos. El proyecto activo lo determina la tarea que se está ejecutando: el agentHost carga automáticamente el contexto del proyecto correspondiente.

---

## Despacho de AgentHost a AgentHost

Los AgentHosts de una misma flota pueden delegarse tareas directamente entre sí, sin pasar por el portal. Esta es la **malla de agentHost a agentHost**.

Todo despacho entre agentHosts está:

- **Firmado con HMAC**: cada carga útil lleva una cabecera `X-AgentHost-Signature: sha256=<hex>`; el agentHost receptor verifica la firma antes de ejecutar nada
- **Autenticado con Bearer**: `Authorization: Bearer <apiKey>` en cada petición
- **Asistido por relay**: los agentHosts que están detrás de NAT o firewalls se comunican a través del Durable Object `AgentHostRelayDO` de Builderforce; no hace falta una ruta de red directa

La topología del relay es la siguiente:

```
AgentHost A (laptop) ──────────────────────────────► Builderforce relay
                                                      │
                                         dispatches to AgentHost B via relay
                                                      │
                                              AgentHost B (server) ◄───────
```

Ninguno de los agentHosts necesita ser accesible desde la red del otro. Builderforce se encarga del enrutamiento.

---

## Visibilidad de la flota a escala

Para los equipos que ejecutan muchos agentHosts, la vista de flota del [Panel](/dashboard) muestra todas las instancias en una sola tabla. Puedes filtrar por:

- **Estado**: solo los que están en línea
- **Proyecto**: agentHosts asignados a un proyecto concreto
- **Capacidad**: agentHosts que declaran una etiqueta de capacidad determinada

La vista de flota es el centro de mando y control de tu malla. ¿Necesitas pausar el trabajo en un agentHost? Cambia su estado a `inactive`. ¿Sospechas que un agentHost se está comportando de forma extraña? Revisa su registro de auditoría de herramientas. ¿Necesitas desplegar una nueva asignación de habilidades en todos los agentHosts? Actualízala a nivel de tenant y cada agentHost la recogerá en su siguiente arranque.

---

## Buenas prácticas

**Pon a tus agentHosts nombres con significado.** `agentHost-1`, `agentHost-2` se vuelve inmanejable enseguida. Con `backend-sean-mbp`, `frontend-ci-worker` o `refactor-server`, la vista de flota se entiende de un vistazo.

**Declara las capacidades con precisión.** Evita declaraciones comodín como `general` o `everything`. Cuanto más acotado sea tu vocabulario de capacidades, mejores serán las decisiones de enrutamiento automático. Si un agentHost es bueno en Python y malo en TypeScript, declara `python` y no `typescript`.

**Asigna un proyecto principal por agentHost siempre que puedas.** Los AgentHosts con muchas asignaciones de proyectos cargan más contexto al arrancar y pueden enrutar trabajo al contexto de proyecto equivocado. Un agentHost, un código base: es el modelo mental más claro.

**Monitoriza `lastSeenAt` en producción.** Configura una alerta en Grafana (o usa los hooks de notificación del portal cuando estén disponibles) para cuando un agentHost pase más de 15 minutos sin conexión en horario laboral: suele indicar una caída del proceso o un cambio de red.

---

## Próximos pasos

- Registra un nuevo agentHost desde [Panel](/dashboard) → Añadir AgentHost
- Explora [Orquestación multiagente](/blog/multi-agent-orchestration) para ver cómo encaja `remote:auto` en un flujo de trabajo completo
- Lee [Asignación de habilidades](/blog/skills-assignment-and-the-marketplace) para entender cómo equipar a los agentHosts de tu flota con capacidades gestionadas desde el portal
