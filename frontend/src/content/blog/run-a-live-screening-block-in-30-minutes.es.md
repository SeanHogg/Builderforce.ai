## Por qué lo consecutivo supera a lo asíncrono

Los currículos en vídeo asíncronos tienen su lugar: te permiten filtrar a 100 candidatos en una tarde. Pero para los candidatos que ya están en tu lista corta, el filtrado asíncrono pierde tres cosas que el síncrono conserva:

1. **Preguntas de seguimiento en tiempo real.** No puedes pedirle a una respuesta grabada que se aclare.
2. **Percepción de la energía y del encaje cultural.** Lo asíncrono edita los momentos que te dicen si realmente querrías trabajar con alguien.
3. **Rapidez de decisión.** Los ciclos solo asíncronos añaden de 3 a 5 días por ronda; los bloques consecutivos te permiten decidir el mismo día.

ZipIntro de ZipRecruiter es el producto canónico aquí. Las Live Screening Sessions de Builderforce son el mismo flujo a una fracción del coste, y se integran con los resultados del AI Recruiter Agent v2 del artículo anterior.

## Paso 1: Declara tu ventana

Llama a `POST /api/recruiter/live-screen/sessions` con la ventana:

```json
{
  "title": "Staff Backend Engineer first-rounds",
  "jobId": "<uuid>",
  "startTime": "2026-06-03T13:00:00Z",
  "endTime": "2026-06-03T15:00:00Z",
  "slotMinutes": 15,
  "meetingUrl": "https://meet.google.com/abc-defg-hij"
}
```

La sesión se guarda en `live_screening_sessions` con el estado `scheduled`. La ventana es de 2 horas; con franjas de 15 minutos, eso da una capacidad de 8 candidatos. Puedes elegir cualquier duración de franja entre 3 y 60 minutos: la mayoría de los reclutadores se quedan en 8 minutos para filtrar y 15 para primeras rondas más a fondo.

## Paso 2: Programa a tus candidatos

Envía con POST tu lista de candidatos a `/sessions/:id/schedule`:

```json
{
  "candidates": [
    { "candidateId": "…", "candidateName": "Alice Chen", "candidateEmail": "alice@example.com" },
    { "candidateId": "…", "candidateName": "Bob Park", "candidateEmail": "bob@example.com" }
  ]
}
```

La función pura `buildBackToBackSchedule` reparte tu ventana en franjas consecutivas y asigna a ellas a los primeros N candidatos. La respuesta te indica la capacidad, cuántos quedaron programados y cuáles (si los hay) se desbordaron: útil cuando has preseleccionado más candidatos de los que cabe en tu ventana.

Cada invitación recibe un `invite_token` de 32 bytes imposible de adivinar. Envía al candidato por correo o SMS el enlace a `https://Builderforce/live-screen/invite/{token}`: no necesita una cuenta de Builderforce para responder.

## Paso 3: El candidato acepta (o rechaza)

Cuando el candidato visita la URL de su invitación, ve la hora de su franja y el título de la sesión. Puede aceptar o rechazar con un clic. Los endpoints públicos —`GET /api/live-screen/invites/:token` y `POST /api/live-screen/invites/:token/respond`— no requieren autenticación, así que el enlace funciona desde cualquier bandeja de entrada.

La URL de la reunión **solo se revela después de que el candidato acepta**. Esto evita filtraciones por compartir la URL y te da una métrica limpia de tasa de aceptación: los candidatos que rechazaron nunca vieron el enlace de la reunión.

En tu panel, observa cómo la lista de invitaciones pasa de `pending` → `accepted` / `declined` a medida que los candidatos responden. La mayoría de las invitaciones se responden en 24 horas; las pocas que no pueden recordarse de nuevo o sustituirse antes de que empiece la ventana.

## Flujo del día

**T-30 minutos.** Abre la vista de detalle de la sesión. Confirma que el número de invitaciones aceptadas coincide con tus expectativas. Vuelve a escribir una última vez a quienes no han respondido.

**T-0.** Abre la URL de la reunión. El candidato 1 se une durante 15 minutos. Haces 2 o 3 preguntas y tomas notas en tu panel. A T+15, el candidato 1 sale y entra el candidato 2: misma sala, misma URL, de forma consecutiva.

**T+sesión.** Cuando sale el último candidato, cambia el estado de la sesión a `completed`. Opcionalmente, marca `no_show` en cualquier invitación que no se presentó. Promueve a los 2 o 3 mejores a tu siguiente ronda a través del pipeline normal.

Un bloque de 2 horas te permite entrevistar a 8 candidatos a 15 minutos cada uno. Eso solía ser dos semanas de "busquemos un momento que nos venga bien". Ahora es una tarde de martes.

## ROI frente a la programación a base de llamadas cruzadas

**El flujo de llamadas cruzadas:** 8 candidatos × (3 correos + 1 reprogramación + llamada de 30 min + 5 min de cierre) = ~4,5 horas de tiempo del reclutador + 14 días naturales desde "interesado" hasta "decisión".

**El flujo de live-screen:** 8 candidatos × (1 invitación + franja de 15 min) = ~2,5 horas de tiempo del reclutador + 3 días naturales.

Tiempo ahorrado por cada 8 candidatos: **2 horas de trabajo del reclutador + 11 días de tiempo de ciclo**. El tiempo de ciclo importa más que las horas del reclutador: el candidato con tres ofertas en marcha aceptará a la empresa que se mueva más rápido. Los bloques de live-screen convierten el tiempo de ciclo en tu ventaja competitiva.

## Preguntas frecuentes

### ¿Los candidatos necesitan una cuenta de Builderforce para aceptar una invitación?

No. El flujo de aceptar / rechazar está completamente tokenizado: la URL de la invitación contiene un token de 32 bytes imposible de adivinar y los endpoints públicos no requieren autenticación. El candidato puede responder desde cualquier dispositivo, cualquier bandeja de entrada, con un clic.

### ¿Builderforce proporciona la sala de vídeo?

No en esta versión. Tú proporcionas la URL de la reunión (Zoom, Meet, Whereby) y Builderforce se encarga de la asignación, la programación, las invitaciones, el flujo de aceptación y los recordatorios. Una sala WebRTC nativa está en la hoja de ruta (Gap Register #1210), pero las salas externas funcionan bien hoy y te permiten reutilizar tus herramientas existentes.

### ¿Puedo asignar candidatos automáticamente desde una ejecución previa del agente?

La asignación automática a una sesión desde una ejecución guardada del agente está en la hoja de ruta (Gap Register #1208). Hoy envías la lista de candidatos de forma explícita. El patrón más común es: ejecutar el AI Recruiter Agent (los 8 mejores por puntuación), copiar esos ID en el cuerpo de `/schedule` y enviar. Dos minutos de principio a fin.

---

**Pruébalo:** [Live Screening Sessions](/hires) en Builderforce.
