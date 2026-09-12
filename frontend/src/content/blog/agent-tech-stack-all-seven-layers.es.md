Todas las explicaciones sobre el «stack tecnológico de los agentes de IA» dibujan la misma imagen: siete capas, cada una con su función y cada una un punto donde el agente puede fallar. El modelo fundacional se lleva los titulares; las seis capas que tiene debajo deciden si la cosa funciona de verdad en producción.

El problema de la versión canónica de ese diagrama es que es una *lista de la compra*. Elige un proveedor de modelos. Añade LangGraph. Suma una biblioteca de memoria. Levanta una base de datos vectorial. Conecta herramientas. Contrata un SaaS de observabilidad. Conteneriza y despliega. Siete capas, siete proveedores, siete modos de fallo y un montón de código pegamento para mantener unidas las costuras.

Builderforce.ai tiene esas mismas siete capas, construidas como **una sola plataforma**. Este artículo recorre cada capa, la relaciona con lo que Builderforce.ai ejecuta realmente y es sincero sobre las dos capas que acabamos de reforzar para pasar de «la tenemos» a «la superamos».

![El stack de agentes de siete capas, implementado de extremo a extremo por Builderforce.ai](/blog/agent-stack-seven-layers.svg)

## El marcador

| # | Capa | El diseño de referencia | Builderforce.ai |
|---|-------|----------------------|-----------------|
| 1 | Modelo fundacional | Elegir un proveedor | Gateway multiproveedor compatible, con enrutamiento y fallback |
| 2 | Orquestación | Bucle ReAct de LangGraph | Bucle ReAct nativo + orquestador multiagente (roles, DAG, reintentos) |
| 3 | Memoria | Una biblioteca para memoria de trabajo y episódica | Los cuatro tipos de memoria, nativos en SSM, con cognición write-through |
| 4 | Base vectorial y RAG | Pinecone/Chroma + embeddings | **Fragmentación + búsqueda híbrida (densa + BM25) + reordenación** sobre LanceDB o almacén SSM |
| 5 | Herramientas e integraciones | `@tool` + MCP | Registro con control por capacidades, servidor MCP, navegador, más de 10 canales |
| 6 | Observabilidad y evaluación | LangSmith/Langfuse | Trazas + medición de costes **+ fidelidad/alucinación + deriva** |
| 7 | Despliegue | Docker + una cola | Cloudflare Workers + Durable Objects + Containers + Docker |

Cinco de ellas ya superaban el diseño de referencia. Dos —RAG y evaluación— eran *buenas, pero convencionales y justas*. Hemos cerrado ambas brechas. Este es el recorrido.

## Capa 1 — Modelo fundacional

Builderforce.ai trata el modelo como un **recurso intercambiable y enrutado**, no como un compromiso permanente. Su gateway compatible con OpenAI expone los proveedores disponibles en el catálogo actual y admite enrutamiento configurado, fallback, credenciales propias (BYO) y controles de razonamiento. La disponibilidad varía según el plan, la región, las credenciales y el entorno de ejecución.

**Veredicto: la supera.** No te juegas el producto a la hoja de ruta de un único proveedor.

## Capa 2 — Orquestación

Un único bucle ReAct (pensar → actuar → observar) es el punto de partida. Builderforce.ai ejecuta ese bucle de forma nativa y coloca encima un **orquestador multiagente**: roles especializados (creador, revisor, generador de tests, analista de bugs…), un grafo de dependencias entre tareas, reintentos acotados con autorreparación y un estado duradero que sobrevive a un reinicio del proceso. El mismo bucle se ejecuta on-prem y en la nube, con una revisión adversarial integrada.

**Veredicto: la supera.** Un equipo coordinado y gobernado gana a un agente solo dando vueltas en un bucle.

## Capa 3 — Memoria

El stack de referencia suele obtener la memoria de trabajo y la episódica de un framework. Builderforce.ai incluye **las cuatro** —de trabajo, episódica, semántica y procedimental— y todas son *nativas en SSM*: el conocimiento se escribe directamente en un modelo (Evermind) mediante destilación en línea, en lugar de limitarse a añadirse a un almacén, con un almacén persistente de hechos entre sesiones por debajo.

**Veredicto: la supera.** Memoria que *aprende*, no memoria que solo *registra*.

## Capa 4 — Base vectorial y RAG  ✦ reforzada en esta versión

Aquí fuimos honestos con nosotros mismos. Builderforce.ai tenía recuperación vectorial (LanceDB + embeddings, además de un almacén de embeddings SSM que no necesita ninguna API), pero era *solo por coseno*. El stack RAG de manual hace tres cosas que la recuperación solo por coseno no hace: **fragmenta** los documentos en pasajes precisos, ejecuta búsqueda **híbrida** (vectores densos *y* BM25 disperso, para que los tokens exactos —identificadores, códigos de error, nombres poco comunes— no se pierdan) y **reordena** por relevancia y diversidad.

Así que incorporamos las tres a la capa de memoria canónica:

![Recuperación híbrida: señales densas y dispersas, fusionadas con RRF y reordenadas con MMR](/blog/hybrid-retrieval.svg)

- **Fragmentación**: un divisor recursivo por caracteres con solapamiento, para que los documentos grandes se conviertan en pasajes coherentes.
- **BM25**: puntuación léxica Okapi junto a la pasada vectorial densa.
- **Reciprocal Rank Fusion**: combina las dos clasificaciones por *posición*, no por puntuaciones brutas que no se pueden comparar.
- **Reordenación MMR**: equilibra relevancia y novedad para que el top-k no sean cinco casi duplicados.

Se degrada con elegancia: si no hay modelo de embeddings disponible, solo BM25; si no hay coincidencia léxica, solo densa. Está conectada tanto al almacén de memoria SSM como a la ruta de memoria a largo plazo de LanceDB, y la fragmentación se aplica al escribir.

**Veredicto: ahora la supera.** La búsqueda híbrida con reordenación es justo la parte a la que la mayoría de los stacks RAG hechos a mano nunca llegan.

## Capa 5 — Herramientas e integraciones

Una herramienta es una función tipada que el modelo puede decidir invocar. Builderforce.ai tiene un **registro de herramientas con control por capacidades** (cada herramienta declara las capacidades que necesita y el entorno de ejecución las filtra por superficie —nube, contenedor, on-prem—, de modo que el mismo conjunto de herramientas funciona en cualquier sitio), un **servidor MCP** que expone herramientas a IDE externos, automatización del navegador con Playwright, herramientas de web, búsqueda, git y shell, más de 10 canales de mensajería y un SDK de plugins para herramientas personalizadas.

**Veredicto: la supera.** Un único contrato de herramientas, todas las superficies, sin curación manual por superficie.

## Capa 6 — Observabilidad y evaluación  ✦ reforzada en esta versión

Los LLM fallan en silencio: una respuesta alucinada sigue devolviendo HTTP 200. Builderforce.ai ya trazaba cada llamada al LLM, medía tokens y costes y puntuaba las ejecuciones por su *resultado* (¿se fusionó la PR?, ¿pasó la CI?, ¿cuántos pasos?, ¿cuánto gasto?). Lo que no hacía era puntuar si la respuesta estaba **fundamentada y era pertinente**: las métricas de evaluación semántica que hoy incluye cualquier herramienta de observabilidad de LLM.

Las añadimos:

![Evaluación y deriva: fidelidad, relevancia y alucinación, además de alertas de regresión](/blog/evaluation-and-drift.svg)

- **Fidelidad**: ¿está la respuesta respaldada por su contexto?
- **Relevancia de la respuesta y del contexto**: ¿responde a la pregunta?, ¿era relevante el contexto recuperado?
- **Tasa de alucinación**: la parte de la respuesta que *no* está fundamentada.

Dos backends, una sola interfaz: un **evaluador léxico de coste cero** se ejecuta en línea en cada ejecución en la nube (sin llamada extra al LLM), y hay disponible bajo demanda una mejora de **LLM como juez** a través de `/api/eval`, facturada por el mismo gateway medido que cualquier otra completion. Las puntuaciones se guardan en el registro de la ejecución, y un **monitor de deriva** —z-score de desplazamiento de la media más Population Stability Index— compara una ventana de referencia con una ventana reciente por (tipo de acción × modelo) y lanza una alerta cuando la calidad empeora. Se ejecuta a diario mediante cron y bajo demanda a través de `/api/eval/drift`.

**Veredicto: ahora la supera.** Una regresión de calidad silenciosa se convierte en una alerta, no en un panel todo en verde.

## Capa 7 — Despliegue

El diseño de referencia es Docker más una API síncrona o una cola asíncrona. Builderforce.ai se ejecuta sobre **Cloudflare Workers + Durable Objects** (un bucle de agente duradero que sigue avanzando más allá de los límites de tiempo del serverless), además de **Containers** para las ejecuciones que necesitan shell, con Docker para el desarrollo local. La caché es de primera clase —lectura a través de caché (L1 dentro del isolate + L2 en KV), caché de prompts y una caché semántica de respuestas—, junto con límites de coste por tenant y presupuestos de pasos.

**Veredicto: la supera.** Duradero, con caché, con costes limitados y gestionado.

## La conclusión

Entender el stack completo no significa ensamblar siete proveedores y rezar para que las costuras aguanten. Builderforce.ai es las siete capas como un único sistema gobernado y observable, y tras esta versión no solo *tiene* todas las capas: **iguala o supera** el diseño de referencia en cada una. Las dos capas que eran simplemente convencionales —la recuperación RAG y la evaluación semántica— ahora son, respectivamente, híbrida con reordenación y puntuada por fidelidad con detección de deriva.

Esa es la diferencia entre un stack que dibujas y un stack que pones en producción.

> ¿Quieres profundizar? Descubre el modelo [Evermind](/evermind) que hay detrás de la capa de memoria, o [empieza a construir gratis](/register).
