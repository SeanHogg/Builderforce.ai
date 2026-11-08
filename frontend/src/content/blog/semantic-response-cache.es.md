Todo equipo que ejecuta IA en producción choca con el mismo muro: **la factura de tokens.** Los modelos de frontera se facturan por token, y la mayoría de los equipos pagan una y otra vez por el mismo trabajo porque dos prompts que *significan* lo mismo parecen distintos como cadenas de texto. "Resume esta PR" y "Dame un resumen de esta pull request" son un fallo de caché para una caché de coincidencia exacta, y una llamada completa y facturada al modelo cada vez.

La respuesta de Builderforce.ai es una **caché semántica con clave de embeddings**: reutiliza una respuesta anterior cuando un nuevo prompt es una *paráfrasis* de uno ya respondido, de modo que nunca se llama al modelo de frontera para trabajo semánticamente repetido.

> La mayor palanca de costes de la pila es una caché semántica que reutiliza una respuesta anterior cuando un nuevo prompt significa lo mismo que uno ya respondido, de modo que el modelo de frontera nunca se factura dos veces por el mismo trabajo.

![Flujo que muestra dos prompts parafraseados colapsando en un único vector de embedding SSM en el dispositivo, y luego pasando en cascada por una caché L1 en el dispositivo y una caché L2 compartida en el gateway —cada una devolviendo una reutilización en caso de acierto— antes de que un fallo total llegue al modelo de frontera facturado, cuya respuesta se almacena de nuevo en L1 y L2](/blog/semantic-cache.svg)

## La caché de coincidencia exacta no basta

Una caché de respuestas tradicional usa como clave la cadena literal del prompt. Solo ayuda cuando el texto *exacto* llega dos veces, algo raro en cargas de trabajo de lenguaje natural. Reformula una pregunta, añade un nombre de archivo, cambia el orden de dos frases y has roto la caché.

Una caché semántica usa como clave el **significado**. Cada prompt se convierte en un vector de embedding; un nuevo prompt es un acierto cuando su vector está lo bastante cerca (por similitud del coseno) de uno ya almacenado. Las paráfrasis colapsan en la misma respuesta cacheada. Esa es la diferencia entre una caché que casi nunca se activa y una que absorbe una gran parte del trabajo repetido.

## Dos niveles: gratis en el dispositivo, más una capa compartida en el gateway

La caché de Builderforce.ai tiene dos niveles y se comparte entre superficies:

- **L1 — local y gratuita.** Una coincidencia de coseno en proceso usando embeddings SSM en el dispositivo. Se ejecuta en el IDE del navegador y dentro de cada agente. Como los embeddings se calculan en el dispositivo (sin llamada a una API de embeddings), L1 es realmente gratuita: consultar la caché no tiene coste por búsqueda.
- **L2 — gateway compartido.** Una capa con ámbito de tenant, respaldada por KV, detrás de los endpoints `lookup`/`store` del gateway. Una paráfrasis respondida en la **aplicación web** puede reutilizarla un **agente**, y viceversa.

Ese uso compartido entre superficies es la clave. Un acierto de caché no queda atrapado en una sesión ni en un dispositivo. Cuando un desarrollador hace una pregunta en el IDE, la respuesta queda disponible más tarde para un agente autónomo: los aciertos de caché de un tenant se convierten en ahorro para toda la plataforma.

```
New prompt
   │
   ├─▶ L1 (on-device SSM embedding, cosine match) ── hit ──▶ reuse, $0
   │                                                │
   │                                              miss
   │                                                ▼
   ├─▶ L2 (gateway KV, tenant-scoped) ──────────── hit ──▶ reuse, no model call
   │                                                │
   │                                              miss
   ▼
Frontier model (billed) ──▶ store answer in L1 + L2
```

## Una caché portátil, sin bifurcación navegador/Node

Ambos niveles funcionan con la *misma* `SemanticCache` portátil del paquete `@builderforce/memory`. El embedder (SSM en el dispositivo) y el backend de L2 se **inyectan**, así que no hay una compilación para navegador y otra para Node que acaben divergiendo. El IDE del navegador y un agente sin interfaz ejecutan una lógica de caché idéntica; solo cambian las dependencias.

Esto importa tanto para la corrección como para el coste: una única implementación significa que un acierto de caché se comporta igual en todas partes, y hay un solo lugar donde ajustar el umbral de similitud.

## Qué cambia en tu factura

El almacenamiento en caché y el rendimiento son ciudadanos de primera clase en Builderforce.ai, al mismo nivel que la seguridad y la corrección. La caché semántica convierte tres patrones caros en baratos:

- **Preguntas repetidas en un equipo** — la segunda persona que pregunta recibe gratis la respuesta de la primera.
- **Reintentos y repeticiones de agentes** — un agente autorreparable que vuelve a intentar un paso no vuelve a pagar por un subprompt idéntico.
- **Flujos entre superficies** — el trabajo que empieza en la aplicación web y continúa en un agente comparte una sola caché.

Combinada con un enrutamiento de modelos que agota los modelos más baratos antes de llegar a los premium, la caché semántica es la razón por la que ejecutar una plantilla de agentes real en Builderforce.ai no significa una factura desbocada.

## El panorama general

La caché semántica es una pieza de la pila de IA en el dispositivo de Builderforce.ai: el mismo sustrato SSM que impulsa el entrenamiento LoRA en el navegador, la memoria persistente de los agentes y la recuperación. El almacenamiento en caché es donde ese sustrato se amortiza de inmediato: cada acierto de caché es una llamada al modelo de frontera que no hiciste.

Si evalúas plataformas de IA por el coste total de propiedad, haz la pregunta que realmente mueve la factura: *¿paga dos veces por la misma respuesta?* En Builderforce.ai, no.

[Empieza a construir gratis →](/register) · [Ver precios →](/pricing) · [Recorre la plataforma →](/product)
