Ya publicamos la versión corta de [por qué existe Evermind](/blog/evermind-self-updating-model): los modelos congelados quedan obsoletos en cuanto se lanzan, y acoplarles un almacén RAG por un lado solo traslada la obsolescencia a otro sitio. Esta es la versión larga: la arquitectura real, las ecuaciones que la sustentan y un relato deliberadamente honesto de lo que hemos *demostrado*, lo que hemos *construido* y lo que sigue siendo una *hipótesis*.

Acompaña a un informe técnico completo escrito para revisión por pares. Si quieres el tratamiento a nivel de tesis doctoral, con cada ecuación referenciada a su archivo fuente, ese documento es el lugar indicado. Este artículo es la visita guiada.

## La tesis, formulada con precisión

Evermind trata la **vigencia**, no la escala, como el eje de diseño principal. La apuesta no es que «un modelo pequeño pueda superar en parámetros a uno grande»: no puede, y no decimos que lo haga. La apuesta es que una arquitectura cuyo *conocimiento está siempre actualizado por construcción*, que *controla su propia generación* y que *cabe dentro del entorno de ejecución donde ocurre el trabajo* gana en los ejes a los que un modelo frontera congelado renuncia por su propia estructura.

Evermind es el modelo en sí, no una memoria acoplada al LLM de otro. Son tres capas que cooperan y reflejan, a grandes rasgos, una descomposición neurofuncional.

![Arquitectura de tres capas de Evermind: una corteza de espacio de estados selectiva, un hipocampo de escritura directa y una capa límbica entrenable, precedidas por un enrutador de inferencia con un puente opcional a modelos frontera](/blog/evermind-architecture-full.svg)

- **Corteza**: un modelo híbrido de espacio de estados con expertos compartidos que genera lenguaje en tiempo lineal *y* puede dar un paso de gradiente en el mismo dispositivo que lo sirve.
- **Hipocampo**: una memoria de conocimiento de escritura directa que *sustituye* las creencias al escribir en lugar de ir añadiéndolas.
- **Sistema límbico**: una pequeña célula recurrente entrenable que modula el afecto.

Las tres son diferenciables. Las tres se ejecutan en WebGPU sin dependencias en tiempo de ejecución. Veámoslas una a una.

## La corteza: un generador selectivo de espacio de estados

El generador no es una pila de atención: es un modelo de espacio de estados (SSM) selectivo de la familia Mamba. Cada canal mantiene un estado oculto `h_t` que evoluciona según una recurrencia lineal que depende de la entrada. Tras una discretización de retención de orden cero con un tamaño de paso `Δ_t` selectivo según el contenido, la actualización por token es simplemente:

```
Ā_t = exp(Δ_t · A)              # state decay (A stored as log(−A) for stability)
B̄_t = (Ā_t − 1) / A · B_t       # input gain
h_t = Ā_t ⊙ h_{t−1} + B̄_t · x_t  # recurrence
y_t = C_t · h_t + D · x_t        # readout
```

La palabra clave es **selectivo**: `Δ_t`, `B_t` y `C_t` se proyectan a partir del propio token, así que la dinámica depende del contenido. Eso es lo que da a un SSM una expresividad similar a la de la atención con un coste lineal.

Dentro de un bloque, la entrada se normaliza con RMS, se proyecta, pasa por una convolución causal 1-D y una compuerta SiLU, recorre el escaneo selectivo, vuelve a pasar por la compuerta `SiLU(z)`, se proyecta a una dimensión menor y se suma de nuevo a un flujo residual. Tres variantes comparten este esqueleto: **Mamba-1** (el escaneo S6 de arriba), **Mamba-2** (dualidad estructurada de espacio de estados: un único `A` escalar por cabeza, que expone una forma de multiplicación de matrices) y **Mamba-3** (un estado de valores complejos con discretización exponencial-trapezoidal, que aporta modos oscilatorios que un `A` diagonal real no puede representar). Opcionalmente, se pueden intercalar capas de atención en un esquema híbrido.

![El bloque SSM selectivo: RMSNorm, proyección de entrada, convolución causal, el escaneo selectivo impulsado por (Δ, B, C) dependientes de la entrada, una compuerta SiLU y una suma residual](/blog/evermind-ssm-block.svg)

### Por qué se paraleliza

Una recurrencia lineal parece secuencial, pero no lo es. Escribe cada paso como un par `(a, b) = (Ā_t, B̄_t·x_t)` y define el operador

```
(a₁, b₁) ∘ (a₂, b₂) = (a₁·a₂,  a₁·b₂ + b₁)
```

Este operador es **asociativo** (el informe técnico lo demuestra, con identidad `(1, 0)`), y la segunda componente acumulada del producto prefijo es exactamente `h_t`. La asociatividad lo es todo: cualquier escaneo asociativo calcula todos los prefijos en `⌈log₂ L⌉` pasadas paralelas. Así, los estados de una secuencia de longitud `L` se obtienen con una profundidad de `O(log L)` y un trabajo de `O(L)`, frente al trabajo `O(L²)` de la atención densa.

![La recurrencia selectiva evaluada como un escaneo prefijo asociativo en paralelo: log L pasadas sobre pares (a, b)](/blog/evermind-parallel-scan.svg)

### Se entrena en el mismo dispositivo que lo sirve

El motor incluye un autograd en modo inverso basado en cinta y un optimizador AdamW en GPU, de modo que la corteza puede dar pasos de gradiente en el navegador. También usamos **WSLA** (Weight-Selective Layer Adaptation): las actualizaciones en línea solo tocan las filas de proyección selectiva que deciden cómo se enruta el contenido hacia el estado, y congelan el grueso de la representación. Eso es lo que abarata el aprendizaje en línea lo suficiente como para ejecutarlo en unas pocas épocas sin un clúster de entrenamiento aparte.

## El hipocampo: Write-Through Cognition

Aquí está la parte realmente distinta. Una caché mantiene frescas las *respuestas*; el hipocampo mantiene fresco el *conocimiento*.

Cada hecho candidato pasa por un único pipeline: **canonicalizar** a una clave de sujeto estable → **recuperar** la creencia vigente → **evaluar** la evidencia → **conciliar** → **escribir directamente**. La conciliación devuelve uno de cuatro veredictos:

- **augment**: sujeto totalmente nuevo; se escribe.
- **confirm**: idéntico al vigente; solo se refresca la confianza.
- **supersede**: hay conflicto y la evidencia respalda la nueva afirmación; se *sustituye* el vigente.
- **reject**: hay conflicto y la evidencia no la respalda; se conserva el vigente.

El almacén es una función parcial de clave a *un único* contenido. No hay anexado. Eso nos da una propiedad que podemos enunciar como teorema y demostrar: **en cada paso, el almacén contiene como máximo un contenido por clave, y un hecho sustituido desaparece, no se limita a quedar por detrás en el ranking.** Un almacén RAG de solo anexado puede hacer resurgir un hecho obsoleto en el momento de la recuperación; Evermind, por su estructura, no puede, porque el contenido obsoleto ya no existe. Por construcción, la tasa de contradicción es cero.

La recuperación se sirve mediante una **caché con token de versión**: la clave de caché incluye un contador de versión global, y cualquier `supersede`/`augment` lo incrementa. Un solo incremento invalida *todas* las recuperaciones en caché en `O(1)`, sin recorrer las entradas una a una. Por tanto, las lecturas siempre están al día.

## Recuperación: búsqueda híbrida

Cuando el modelo recurre a la memoria, fusiona dos rankings —similitud coseno densa sobre embeddings normalizados y una puntuación léxica BM25— mediante reciprocal rank fusion (`k = 60`), y después diversifica la parte alta de la lista con maximal marginal relevance (`λ = 0.7`). El resultado es un top-K con límite estricto (5 por defecto) y contenido truncado, de modo que la memoria *reduce* el tamaño del prompt en lugar de inflarlo.

![Recuperación híbrida: rankings de coseno denso y BM25 disperso fusionados mediante reciprocal rank fusion y diversificados con MMR](/blog/evermind-hybrid-recall.svg)

## La capa límbica

La más pequeña de las tres: una célula recurrente con compuertas que transforma un embedding de experiencia y un estado afectivo en un delta de afecto acotado y una estimación de recompensa. La actualización es un integrador con fugas: una compuerta aprendida decide cuánto afecto previo persiste frente a cuánta experiencia nueva se admite. **La personalidad se codifica como puntos de referencia fijos; la célula límbica aporta la dinámica a su alrededor.** Se entrena con un objetivo MSE sencillo sobre valores observados `(Δaffect, reward)`.

## Enrutamiento y destilación en línea

Cada petición llega primero a un enrutador que siempre prueba antes la opción más barata. ¿No hay configurado ningún puente a un modelo frontera? Se sirve desde el SSM en el dispositivo. Si lo hay, el enrutador solo escala cuando una prueba sintáctica barata (palabras clave de complejidad, longitud de la entrada) o, en último lugar, una sonda de perplejidad indica que el modelo local no da la talla. Cuando escala, la respuesta del modelo frontera no se limita a devolverse: se convierte en una **señal de profesor**. La corteza se destila sobre ella con WSLA, con una compuerta que omite los patrones que ya ha aprendido. El ciclo se cierra en el dispositivo, y los pesos adaptados se guardan en un checkpoint.

## Qué está demostrado, qué está construido y qué sigue siendo una hipótesis

Esta es la parte que la mayoría de los artículos de arquitectura se saltan, y la que más importa a cualquiera que evalúe las afirmaciones.

**Demostrado e implementado.** Las tres familias de kernels SSM, el autograd y el optimizador, el operador de conciliación con su invariante de un único vigente y su invalidación en `O(1)`, la recuperación híbrida, la célula límbica, el enrutador, el ciclo de destilación, el pipeline de exportación (safetensors / ONNX / GGUF / Hugging Face; ONNX verificado con una paridad de logits inferior a `1e-5` frente a la pasada hacia delante de referencia) y el **arnés de benchmarking** están construidos y probados.

**Medido, no solo afirmado.** La pregunta «¿cómo de bueno es este modelo?» ya no queda a la espera de un protocolo futuro. El motor incluye un arnés de benchmarking que se ejecuta en el dispositivo desde el Studio: reserva una parte del corpus con la que el modelo nunca entrena y después informa de la perplejidad sobre esos datos reservados, los bits por token, la precisión top-1 y top-k del siguiente token y el rendimiento de generación. Además, puede hacer un A/B entre dos checkpoints para que una adaptación tenga que *demostrar* que mejora a la anterior. Todo modelo entrenado en el Studio recibe ese informe de resultados antes de poder publicarse.

**Todavía una hipótesis.** Lo que ese arnés aún no hace es ejecutar la *comparación* a escala. Las afirmaciones comparativas —que Evermind supera a un modelo frontera congelado en *vigencia*, que sostiene una generación interactiva con una fracción de la huella de memoria y que la destilación WSLA mejora sin olvido catastrófico— figuran en el informe como **hipótesis falsables con un protocolo de medición**, no como victorias en benchmarks. El instrumento ya existe y es abierto; enfrentarlo cara a cara con una línea base congelada es el siguiente hito, y hasta que tengamos esas cifras seguiremos llamándolas hipótesis. La contribución honesta de hoy es la formalización, la implementación abierta y los medios para medirla.

Creemos que esa es la forma correcta de publicar una afirmación de investigación: hacerla precisa, hacerla abierta y hacer que sea fácil de refutar.

---

*Evermind se construye sobre la familia de paquetes abiertos `builderforce-memory` (engine / runtime / MCP). El informe técnico completo —con cada ecuación referenciada a su archivo fuente, las demostraciones íntegras y el protocolo de evaluación— está disponible bajo petición.*

[Explora Evermind →](/evermind) · [Lee la versión corta →](/blog/evermind-self-updating-model) · [Empieza a crear gratis →](/register)
