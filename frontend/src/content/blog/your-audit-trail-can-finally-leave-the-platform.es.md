# Tu registro de auditoría por fin puede salir de la plataforma

Los spans de las ejecuciones de agentes ya se enviaban a tu propio recolector de OpenTelemetry — Honeycomb, Datadog, Grafana, el que uses. Tu registro de auditoría no podía. Inicios de sesión, cambios de rol, claves de API, decisiones de aprobación, llamadas a herramientas de agentes: todo registrado, nada exportable. Un equipo de seguridad con un SIEM veía el trabajo de los agentes como una isla, y el registro de auditoría como una segunda.

Ahora ambas islas están conectadas. Cualquier exportador de OpenTelemetry también puede enviar eventos de auditoría como logs OTLP al endpoint `/v1/logs` de tu recolector.

## Elige tus señales

Un exportador ahora indica qué señales envía:

- **Solo trazas** — exactamente lo que hacían los exportadores antes. Nada cambia para las filas existentes.
- **Solo auditoría** — el registro de seguridad va a tu SIEM; las trazas de ejecución se quedan en el producto.
- **Ambas** — un recolector, dos señales. Las trazas van a `/v1/traces`, los logs de auditoría a `/v1/logs`.

## El conjunto de eventos

El barrido cubre la superficie de seguridad que un revisor pregunta: inicios de sesión y sesiones, cambios de rol y membresía, cambios de claves de API, exportaciones, conexiones de integración, decisiones de aprobación y llamadas a herramientas de agentes.

Dos propiedades importan más que la lista misma. La entrega es al-menos-una-vez con el id de cada evento como clave de deduplicación, y un cursor por fuente significa que un lote fallido se reintenta exactamente donde se detuvo: sin pérdidas, sin duplicados. Y una caída del recolector nunca ralentiza una petición: el barrido se ejecuta en segundo plano, y en cuanto un recolector empieza a fallar, la fila del exportador en Ajustes lo dice, en la misma línea de salud que ya mostraba la entrega de trazas.

## La línea de alcance

La exportación de un espacio de trabajo solo lleva los eventos de ese espacio. El registro del operador — el `admin_audit_log` entre espacios — nunca se exporta a un espacio de trabajo. Tu SIEM ve tu espacio, no el de nadie más.

Configúralo en **Ajustes → Integraciones → Exportación a OpenTelemetry**.
