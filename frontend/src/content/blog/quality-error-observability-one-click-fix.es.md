Toda herramienta de monitorización de errores es un hermoso callejón sin salida. Agrupa tus fallos, los ordena por frecuencia, te muestra una traza de pila… y luego te devuelve el trabajo. Alguien todavía tiene que leerla, encontrar el archivo, escribir la corrección y abrir la PR. El panel es donde el error *se detiene*, no donde se *resuelve*.

El **pilar Quality** de Builderforce.ai cierra ese bucle. Ingiere errores como cualquier herramienta de observabilidad y luego convierte cualquier grupo de errores en una tarea que tu plantilla de agentes recoge y entrega como pull request.

> Builderforce.ai ingiere errores de ejecución de muchas fuentes, los agrupa por huella digital en grupos de errores deduplicados y convierte cualquier grupo en una tarea de corrección con un clic que un agente en la nube recoge y entrega como pull request: del fallo a la PR en una sola superficie.

![Canalización de izquierda a derecha que muestra un error de ejecución fluyendo hacia un grupo de errores con huella digital, el tablero /quality, una tarea de corrección con un clic y un agente en la nube entregando una pull request en un solo hilo](/blog/quality-observability.svg)

## Ingiere desde donde ya viven tus errores

No tienes que arrancar lo que ya tienes. Quality normaliza cinco fuentes detrás de una única forma de evento canónica:

- **Nativo** — el SDK de navegador `@seanhogg/builderforce-quality` captura automáticamente `window.onerror` y los rechazos de promesas no gestionados, los agrupa en lotes y los envía con un temporizador o al ocultar la página mediante `sendBeacon`, para que no se pierda nada al navegar. Añade una sola etiqueta `<script>` y ya estás reportando.
- **OpenTelemetry (OTLP)** — apunta tu exportador OTLP existente al endpoint de ingesta; los registros de nivel error y los spans con estado de error se convierten en eventos de error.
- **Sentry, PostHog, LogRocket** — conecta un webhook y la plataforma verifica su firma HMAC, normaliza la carga útil y la incorpora al mismo flujo. Las conexiones de Sentry pueden rellenar incidencias históricas al conectarse.

Cada fuente llega como el mismo `NormalizedErrorEvent`, así que todo lo que viene después —la agrupación, el panel, la corrección— es independiente de la fuente.

## Agrupación por huella digital que no te ahoga

Los eventos en bruto son ruido; los **grupos** son señal. Cada evento recibe una huella digital: una huella explícita cuando la fuente la proporciona o, si no, una derivada del frame superior de la pila más un mensaje normalizado (literales, hex, UUID y números sueltos eliminados para que el mismo error no se bifurque en mil grupos). Los eventos se insertan o actualizan en un grupo con clave `(tenant, project, fingerprint)`, aumentando los recuentos de ocurrencias y de usuarios distintos exactos, refrescando la traza de pila de muestra y reabriendo un error resuelto si reaparece.

El panel `/quality` lista esos grupos por estado y nivel, con una tendencia de 14 días y el recuento de usuarios afectados en cada uno, para que clasifiques lo que realmente está dañando a los usuarios, no un torrente de eventos individuales.

## El botón que entrega la corrección

Abre un grupo, lee la traza y haz clic en **Corregir con agente**. Builderforce.ai crea una tarea de tablero —titulada a partir del error, priorizada según su nivel (fatal → urgente, error → alta, y así sucesivamente), con un resumen del tipo, el entorno, la URL, los recuentos de ocurrencias y de usuarios, y la traza de pila— y despacha de inmediato a un agente en la nube. El agente lee el resumen, encuentra el código, escribe el cambio y abre una pull request. El grupo de errores enlaza con la tarea, así que el fallo, la corrección y la PR viven en un mismo hilo.

Como funciona sobre la misma plataforma instrumentada, el volumen de errores es un recurso medido (`error_events`) que se suma a la misma vista de consumo que los tokens y la ingesta: una única fuente de verdad sobre lo que estás usando, aplicada exactamente como se muestra.

## Por qué importa

La observabilidad que termina en un panel hace que los errores sean *visibles*. La observabilidad conectada a una plantilla de agentes hace que *desaparezcan*. Cuando la misma plataforma que muestra el fallo también puede asignarlo, corregirlo y abrir la PR, el tiempo medio de resolución deja de depender de quién está de guardia y pasa a depender de la rapidez con la que trabajan tus agentes.

[Recorre la plataforma →](/product) · [Lee la pila de agentes de siete capas →](/blog/agent-tech-stack-all-seven-layers) · [Empieza a construir gratis →](/register)
