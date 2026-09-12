## El flujo de siempre frente al flujo con agente

**El flujo de siempre.** Escribes a mano una búsqueda booleana. Revisas 200 perfiles. Preseleccionas 15. Redactas a mano un mensaje de contacto para cada uno. Pones un recordatorio en el calendario para hacer seguimiento a los tres días y otro a los siete. Te olvidas del segundo. La mitad de tus candidatos nunca vuelve a saber de ti. Todo el proceso te lleva dos horas por puesto.

**El flujo con agente.** Pegas un brief en lenguaje natural —«buscamos un ingeniero de infraestructura senior staff con amplia experiencia en Go y Kubernetes para una fintech de Serie C en Nueva York, más de 7 años»— y el agente te devuelve una lista de candidatos ordenada, un mensaje personalizado para cada uno y una secuencia de seguimiento programada. Cinco minutos, un puesto.

El AI Recruiter Agent no sustituye tu criterio: elimina las pulsaciones de teclado entre tu criterio y el mensaje enviado.

## Paso 1: Recepción (brief → criterios estructurados)

Llama a `POST /api/recruiter/agent/intake` con `{ briefText: "…" }`. El agente analiza el brief y devuelve criterios estructurados:

```json
{
  "jobTitle": "Senior Staff Infrastructure Engineer",
  "skills": ["go", "kubernetes", "terraform"],
  "location": "New York, NY",
  "experienceYears": 7,
  "maxCandidates": 20,
  "source": "brief"
}
```

O, si ya tienes una oferta de empleo publicada, pasa `{ jobId: "<uuid>" }` y el agente deriva la misma estructura a partir de la fila de la oferta: título, habilidades y ubicación, con la experiencia deducida de la descripción.

Este paso de recepción es lo que LinkedIn comercializa como Semantic Sourcing: en lugar de teclear `(go OR golang) AND kubernetes AND "New York"`, describes el puesto en lenguaje natural. El agente funciona en modo solo heurístico cuando no hay ninguna clave de LLM configurada, así que la superficie siempre devuelve una estructura de criterios utilizable; resulta útil para el desarrollo local y para degradarse con elegancia cuando el proveedor del modelo no está disponible.

## Paso 2: Búsqueda (criterios → candidatos ordenados + borradores de contacto)

Envía la respuesta de la recepción a `POST /api/recruiter/agent/source`. El agente hace tres cosas en un solo viaje de ida y vuelta:

1. **Busca**: empareja por palabras clave a los candidatos de la base de datos de currículums con las habilidades de los criterios.
2. **Puntúa**: pasa a cada candidato por el LLM con el contexto del puesto y devuelve una puntuación de encaje de 0 a 100 y una razón en una frase.
3. **Redacta el contacto**: para cada candidato, genera un mensaje personalizado de tres frases para LinkedIn o correo electrónico que hace referencia a su trayectoria real, no a una plantilla genérica.

La ejecución se guarda en `recruiter_agent_runs` para que puedas volver a ella más tarde con `GET /api/recruiter/agent/runs/:id`. Los resultados se ordenan por puntuación descendente: revisa los 10 primeros, descarta los que no encajan y pasa al paso 3 con el resto.

## Paso 3: Programar los seguimientos (cadencia persistente)

Los seguimientos manuales son el punto por el que el 90 % de los flujos de reclutamiento pierden candidatos. El tercer superpoder del agente es hacerlos persistentes.

Para cada candidato al que quieras hacer seguimiento, llama a `POST /api/recruiter/agent/followups/schedule` con `{ runId, candidateId, dayOffset, body }`. Los valores predeterminados son 3 días para el primer seguimiento, 7 para el segundo y 14 para el último. Personaliza el texto o usa el borrador generado por IA.

Un worker de cron (`recruiter-agent-followup`, que se ejecuta cada 5 minutos) cambia las filas vencidas de `pending` a `sent` y materializa el recordatorio en tu feed de `candidate_interactions`, para que lo veas en tu panel en cuanto llega el momento. Cancela cualquier seguimiento programado con `POST /api/recruiter/agent/followups/:id/cancel` si el candidato ya ha respondido.

Esta es la parte por la que LinkedIn Hiring Assistant cobra miles de dólares por licencia. En Builderforce forma parte del plan Pro sin recargo por licencia; la [página de precios](/pricing) muestra la tarifa actual.

## Cálculo del ROI: lo que ahorran 5 minutos por puesto

Estimaciones conservadoras para un reclutador que cubre un puesto al día, 20 días laborables al mes:

- **Flujo manual:** ~2 horas por puesto × 20 puestos = **40 horas al mes** en búsqueda, contacto y seguimiento.
- **Flujo con agente:** ~5 minutos por puesto × 20 puestos = **100 minutos al mes** para el mismo flujo.
- **Tiempo recuperado: ~38 horas al mes** para dedicar a entrevistar, cerrar contrataciones y gestionar el equipo en lugar de teclear.

Los clientes de LinkedIn Charter que usan Hiring Assistant informan de un 62 % menos de perfiles revisados, más de 4 horas ahorradas por puesto y un 69 % más de aceptación de InMail. El agente de Builderforce ejecuta el mismo ciclo dentro del plan Pro, sin la cuota adicional de Hiring Assistant.

El ROI oculto está en la cadencia de seguimiento. La mayoría de los reclutadores pierden más candidatos por olvidarse de hacer seguimiento que porque los candidatos digan que no. Los seguimientos programados te dan, en la práctica, un +30 % en la parte alta del embudo sin enviar ni un solo mensaje de contacto adicional.

## Preguntas frecuentes

### ¿El AI Recruiter Agent envía los mensajes automáticamente?

Todavía no: por ahora, el agente materializa el mensaje como borrador en tu feed de interacciones con candidatos y tú lo envías por el canal que elijas (correo electrónico, LinkedIn, SMS). El envío automático a través del Comm Hub está en la hoja de ruta (Gap Register #1206); la arquitectura actual mantiene deliberadamente al reclutador en el circuito para que una alucinación del LLM no pueda escribir a un candidato sin revisión.

### ¿Qué pasa si el proveedor del LLM no está disponible?

El endpoint de recepción recurre a una heurística determinista que extrae del brief el puesto, las habilidades (mediante coincidencia con un diccionario), la ubicación y los años de experiencia. El endpoint de búsqueda recurre a una puntuación base más un mensaje de plantilla para cada candidato. La superficie se degrada, nunca da error.

### ¿En qué se diferencia de una búsqueda booleana?

Una búsqueda booleana devuelve a todo el que coincide con las palabras clave. El agente los ordena según un encaje calculado por el LLM, redacta un mensaje personalizado para cada uno y programa los seguimientos: los tres pasos que convierten una búsqueda en una contratación. Puedes seguir escribiendo búsquedas booleanas; el agente trabaja por encima.

---

**Pruébalo:** [AI Recruiter Agent](/hires) en Builderforce.
