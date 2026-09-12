Todos los equipos de Builderforce comparten la misma infraestructura de API. Ningún equipo puede ver los proyectos, agentes, tareas ni conversaciones de otro. Este aislamiento no es una función añadida a posteriori: es el supuesto arquitectónico fundamental sobre el que se construye cada consulta a la base de datos, cada ruta de la API y cada despacho de agentes.

Este artículo explica el modelo de confianza, el sistema de control de acceso, cómo funciona la autenticación de los agentes y qué cubre el registro de auditoría.

![Diagrama de la seguridad multi-tenant de Builderforce: tres carriles de tenant aislados y separados por muros cerrados, tres mecanismos de autenticación (JWT web, clave de API de AgentHost con hash y firma de despacho HMAC-SHA256) y aislamiento a nivel de consulta, en el que cada consulta con ámbito de tenant incluye un filtro eq(tenantId)](/blog/security-multitenant.svg)

---

## El modelo de tenant

Un **tenant** (organización) es el espacio de trabajo aislado de tu organización en Builderforce. Todos los recursos —proyectos, tareas, agentHosts, agentes, habilidades, aprobaciones, conversaciones— pertenecen a un tenant. No existe visibilidad ni uso compartido entre tenants.

Los usuarios pertenecen a uno o varios tenants, con un **rol** específico en cada uno:

| Rol | Qué puede hacer |
|---|---|
| `viewer` | Acceso de solo lectura a proyectos, tareas, historial de chat y observabilidad |
| `developer` | Acceso de lectura y escritura a proyectos y tareas; puede interactuar con el IDE y el chat |
| `manager` | Todo el acceso de developer y, además: aprobar o rechazar puntos de aprobación, gestionar instancias de agentHost, asignar habilidades y gestionar miembros |
| `owner` | Todo el acceso de manager y, además: facturación, eliminación del tenant e integraciones de control de código fuente |

Los roles se aplican en la capa de la API: cada endpoint protegido comprueba el rol de quien hace la llamada frente al mínimo requerido antes de procesar la petición. Un developer que intente aprobar un punto de aprobación recibirá un `403`.

---

## Autenticación

Builderforce usa un **modelo de autenticación de doble token** diseñado para separar limpiamente las sesiones del navegador del acceso de los agentes a la API.

### JWT web (sesiones de usuario)

Los usuarios del navegador se autentican con correo electrónico y contraseña y reciben un JWT de corta duración. El token codifica:

- `userId`: el usuario autenticado
- `tenantId`: el contexto de tenant de esta sesión
- `role`: el rol del usuario en ese tenant
- `exp`: la caducidad (corta; renovable)

Todas las operaciones con JWT pasan por las rutas `/api/auth`. Los tokens se pueden revocar uno a uno desde la página de ajustes de Seguridad.

### Autenticación multifactor

Los usuarios pueden activar la MFA basada en TOTP desde [Ajustes → Seguridad](/security). Una vez activada, cada inicio de sesión exige el código TOTP además de la contraseña.

Los códigos de recuperación se generan al activar la MFA: guárdalos en un lugar seguro. Se cifran con hash de inmediato y no se pueden recuperar.

### Claves de API de AgentHost

Las instancias de BuilderForce Agents no usan JWT. Cada agentHost registrado recibe una **clave de API en texto plano que se muestra una sola vez** en el momento del registro. La clave se cifra con hash de inmediato y el texto plano nunca se almacena: si la pierdes, generas una nueva.

El agentHost envía esta clave mediante `Authorization: Bearer <key>` en cada petición. La API la verifica frente al hash almacenado y resuelve el contexto de tenant a partir del registro del agentHost.

**Las claves nunca aparecen en las URL.** Era un patrón heredado en algunos endpoints de Builderforce que ya se ha migrado: todos los endpoints autenticados por agentHost usan ahora únicamente la cabecera `Authorization`, lo que mantiene las claves fuera de los registros de acceso del servidor y de las cachés de la CDN.

---

## Gestión de sesiones

Cada sesión activa del navegador se registra en la tabla `auth_user_sessions`. Los managers pueden ver y revocar las sesiones de cualquier usuario de su tenant desde el panel de Seguridad.

La vista de sesiones muestra:

| Campo | Valor |
|---|---|
| ID de sesión | Identificador único |
| Agente de usuario | Navegador y sistema operativo |
| Dirección IP | Última IP registrada |
| Creada | Hora de inicio de la sesión |
| Última actividad | Última petición autenticada |
| Estado | Activa o revocada |

Revocar una sesión invalida todos los tokens emitidos dentro de ella. El usuario queda desconectado en su siguiente petición.

---

## Confianza y seguridad del despacho en BuilderForce Agents

La malla de agentHosts introduce una superficie de confianza adicional: el despacho de agentHost a agentHost. Cuando el AgentHost A envía una tarea al AgentHost B, el AgentHost B necesita verificar que la petición procede realmente del AgentHost A, y no de un atacante que ha descubierto el endpoint del AgentHost B.

Builderforce usa **firma de cargas útiles con HMAC-SHA256** en todo despacho entre agentHosts:

```
AgentHost A sends:
  POST /api/agent-hosts/:id/forward
  Authorization: Bearer <agentHostApiKey>
  X-AgentHost-Signature: sha256=<hmac>
  X-AgentHost-From: <sourceAgentHostId>
  Body: { task: "..." }
```

El HMAC se calcula sobre el cuerpo sin procesar de la petición, usando como secreto la clave de API del agentHost emisor. El agentHost receptor (a través de `verifyAgentHostSignature` de Builderforce) vuelve a calcular el HMAC y los compara. Si no coinciden, devuelve `403` antes de procesar la carga útil.

Si no hay firma, Builderforce acepta la petición por compatibilidad con versiones anteriores, pero registra su ausencia. En una futura versión de refuerzo, la falta de firma en las tareas reenviadas pasará a ser motivo de rechazo definitivo.

---

## El registro de auditoría

Toda acción relevante en Builderforce queda registrada en el **registro de auditoría**, accesible en [/admin](/admin) para owners y managers.

El registro de auditoría captura:

| Tipo de evento | Qué lo desencadenó |
|---|---|
| `tenant.member_added` | Usuario añadido al tenant |
| `tenant.member_removed` | Usuario eliminado del tenant |
| `agentHost.registered` | Nueva instancia de BuilderForce Agents creada |
| `agentHost.status_changed` | AgentHost activado, desactivado o suspendido |
| `approval.created` | Un agente solicitó un punto de aprobación |
| `approval.decided` | Un manager aprobó o rechazó |
| `task.created` | Tarea creada en el tablero |
| `execution.submitted` | Tarea enviada a ejecución |
| `execution.state_changed` | La ejecución pasó a running/completed/failed |
| `project.created` | Nuevo proyecto creado |
| `skill.assigned` | Habilidad asignada al tenant o a un agentHost |

Cada evento registra quién, qué, cuándo, sobre qué recurso (tipo e ID) y metadatos estructurados.

### Eventos de auditoría de herramientas

Aparte del registro de auditoría del tenant, el **registro de auditoría de herramientas** guarda cada llamada a herramienta que realiza un agente de BuilderForce Agents: el nombre de la herramienta, los argumentos de entrada, el resultado, la duración y si tuvo éxito o dio error. Este registro es la fuente de verdad sobre «qué hizo realmente el agente»: útil para depurar y para las revisiones de cumplimiento.

---

## Arquitectura de aislamiento de datos

El aislamiento multi-tenant se aplica a nivel de consulta a la base de datos, no a nivel de lógica de la aplicación.

Cada consulta sobre una tabla con ámbito de tenant incluye una condición `tenantId` explícita:

```typescript
const rows = await db
  .select()
  .from(projects)
  .where(
    and(
      eq(projects.tenantId, tenantId),  // always present
      eq(projects.status, 'active'),
    )
  );
```

No existe ninguna ruta de «seleccionar todo» que omita el filtro de tenant. Aunque la lógica de la aplicación tuviera un bug, la consulta no devolvería datos de otro tenant.

Las instancias de BuilderForce Agents también están acotadas a su tenant: un agentHost registrado en el Tenant A no puede recibir tareas despachadas por el Tenant B, no puede aparecer en la vista de flota del Tenant B y no puede leer el contexto de proyecto del Tenant B.

---

## Controles de privacidad

Builderforce admite solicitudes de cumplimiento del RGPD (GDPR) y la CCPA. Los usuarios pueden enviar una solicitud de eliminación o de acceso a sus datos desde los ajustes de su cuenta, o un manager puede enviarla en su nombre.

Las solicitudes de privacidad siguen un flujo de trabajo formal:

```
submitted → in_review → completed / closed
```

Todos los datos personales asociados a la solicitud (historial de chat, eventos de auditoría, instantáneas de uso) se pueden eliminar a petición del interesado, conforme a la normativa aplicable.

---

## Seguridad del control de código fuente

Cuando conectas una cuenta de GitHub o Bitbucket mediante la integración de control de código fuente, Builderforce solo almacena:

- El identificador de la cuenta (organización/nombre de usuario)
- La URL del host (para GitHub Enterprise autoalojado)
- El tipo de integración

En la base de datos de Builderforce no se almacenan tokens OAuth ni PAT. La gestión de los tokens corre a cargo de la instancia de BuilderForce Agents que ejecuta las operaciones de git.

---

## Hoja de ruta de seguridad

Hay varias mejoras de seguridad previstas para la Fase 2 y posteriores:

- **Firmas HMAC obligatorias**: rechazar el despacho sin firmar entre agentHosts, sin periodo de compatibilidad con versiones anteriores
- **Dispositivos de confianza**: registrar dispositivos de confianza y exigir una nueva autenticación desde dispositivos nuevos
- **Listas de IP permitidas**: restringir el acceso al tenant a rangos CIDR concretos
- **SSO**: SAML y OIDC para proveedores de identidad empresariales
- **Exportación a SIEM**: enviar los eventos de auditoría a sistemas de registro externos mediante OTel

---

## Buenas prácticas

**Rota las claves de API de los agentHosts cada trimestre.** Una clave que nunca se ha rotado es una clave que puede llevar meses en un archivo de historial de la shell. Registra una clave nueva, actualiza la variable de entorno del agentHost, reinícialo y revoca la clave antigua.

**Usa el rol mínimo necesario.** Los developers no necesitan acceso `MANAGER`. Los revisores no necesitan acceso `DEVELOPER`. La asignación de roles debe corresponderse con la responsabilidad real de cada persona.

**Activa la MFA para todos los managers y owners.** Las cuentas de developer con acceso de lectura y escritura son objetivos valiosos; las cuentas de manager que pueden aprobar acciones destructivas lo son todavía más.

**Revisa el registro de auditoría de herramientas tras cualquier comportamiento inesperado de un agente.** Antes de volver a ejecutar un flujo de trabajo que produjo un resultado sorprendente, lee lo que hizo realmente el agente: el registro de auditoría de herramientas es la fuente autorizada.

---

## Próximos pasos

- Revisa las asignaciones de roles de tu equipo en [Ajustes → Miembros](/settings)
- Activa la MFA desde [Ajustes → Seguridad](/security)
- Consulta el [Registro de auditoría](/admin) para ver los eventos relevantes recientes de tu tenant
- Lee [Puntos de aprobación y supervisión humana](/blog/approval-gates-and-human-oversight) para conocer los controles con intervención humana que complementan la seguridad de la plataforma
