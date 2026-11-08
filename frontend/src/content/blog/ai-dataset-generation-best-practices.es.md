La calidad de tu agente ajustado depende casi por completo de la calidad de sus datos de entrenamiento. Basura entra, basura sale, pero con unas cuantas prácticas deliberadas puedes generar conjuntos de datos que marcan una diferencia real.

![Pipeline de buenas prácticas para conjuntos de datos: desde un prompt de capacidad preciso, pasando por muestras diversas, revisión de muestras y evaluación con IA, hasta una exportación JSONL versionada, con un bucle de retroalimentación de iteración](/blog/dataset-generation.svg)

## Empieza con un prompt de capacidad preciso

El prompt de capacidad es la semilla de todo tu conjunto de datos. Los prompts vagos producen conjuntos genéricos; los prompts específicos producen conjuntos dirigidos y útiles.

**Prompt débil:**
> «Un asistente de programación útil.»

**Prompt sólido:**
> «Un asistente de TypeScript especializado en refactorizar JavaScript heredado a TypeScript moderno. Identifica tipos `any` implícitos, añade anotaciones explícitas, convierte los `require` de CommonJS en `import` de ESM y explica cada cambio con una justificación de una frase.»

La diferencia en el conjunto de datos resultante, y en el agente resultante, es enorme.

## Busca la diversidad

Un buen conjunto de datos cubre la *distribución completa* de entradas que tu agente encontrará en producción. Usa los **ajustes de diversidad** de Builderforce para aumentar la variación en:

- **Complejidad de entrada**: mezcla ejemplos simples, medios y complejos
- **Casos límite**: incluye entradas mal formadas, peticiones ambiguas y casos límite difíciles
- **Tono y formato**: varía el estilo de redacción de preguntas y respuestas

Un conjunto de 500 ejemplos diversos suele rendir mejor que uno de 2 000 ejemplos casi duplicados.

## Usa el modelo adecuado para la generación

Builderforce te permite elegir cualquier modelo de OpenRouter para generar datos. Orientación general:

| Caso de uso | Modelos recomendados |
|----------|-------------------|
| Conjuntos centrados en código | Claude 3.5 Sonnet, GPT-4o, Gemini 1.5 Pro |
| Conjuntos de razonamiento | o1, Claude 3 Opus |
| Ajuste de instrucciones general | Llama 3.1 70B, Mistral Large |
| Generación con presupuesto limitado | Gemini Flash, Llama 3.1 8B |

Para dominios especializados (medicina, derecho, finanzas), combina un modelo base potente con ejemplos específicos del dominio en tu prompt de capacidad.

## Revisa una muestra antes de entrenar

No entrenes con datos autogenerados sin revisarlos antes. Builderforce te muestra una muestra aleatoria de 20 ejemplos antes de que te comprometas a entrenar. Fíjate en:

- ✅ Instrucciones claras y sin ambigüedad
- ✅ Respuestas precisas y detalladas
- ✅ Formato coherente
- ❌ Datos inventados o código que no compila
- ❌ Respuestas demasiado cortas o fuera de tema
- ❌ Duplicados o casi duplicados

Si más del 10–15 % de la muestra no convence, regenera con un prompt refinado.

## Combina conjuntos de datos para agentes complejos

Para agentes que necesitan varias capacidades, genera **conjuntos de datos separados por capacidad** y fusiónalos antes de entrenar. Así controlas la mezcla:

```
dataset_a: 300 examples for TypeScript refactoring
dataset_b: 200 examples for code explanation
dataset_c: 100 examples for error diagnosis
─────────────────────────────────────────────────
merged:    600 examples, 50% / 33% / 17% split
```

Un reparto 50/33/17 inclina al agente hacia su tarea principal sin perder agudeza en las capacidades secundarias.

## Usa la evaluación con IA para cerrar el bucle

Tras el entrenamiento, ejecuta la **Evaluación con IA** sobre una partición de prueba reservada (Builderforce reserva automáticamente el 20 % del conjunto de datos). El informe de evaluación muestra:

- **Puntuación de corrección**: ¿la salida responde a la instrucción?
- **Puntuación de razonamiento**: ¿es sólida la lógica?
- **Tasa de alucinación**: ¿la salida contiene datos inventados?

Si las puntuaciones están por debajo del objetivo, mira qué *categorías* de ejemplos puntuaron más bajo: esas son las capacidades que necesitan más datos de entrenamiento.

## Itera con rapidez

Los mejores conjuntos de datos se construyen de forma iterativa. Un buen flujo de trabajo:

1. Genera 200 ejemplos → entrena → evalúa
2. Identifica las áreas débiles a partir del informe de evaluación
3. Genera 100 ejemplos dirigidos a las áreas débiles
4. Fusiona los conjuntos → reentrena → evalúa de nuevo
5. Repite hasta que las puntuaciones alcancen tu listón

Cada iteración tarda unos 15–20 minutos de principio a fin con el pipeline en el navegador de Builderforce.

## Exporta y versiona tus conjuntos de datos

Exporta siempre tu conjunto de datos final como archivo JSONL antes de entrenar. Esto te da:

- Un artefacto de entrenamiento reproducible
- La posibilidad de reentrenar más adelante sobre otro modelo base
- Un punto de partida para futuras iteraciones

Nombra tus exportaciones de forma semántica: `typescript-refactor-v1.jsonl`, `typescript-refactor-v2-more-edge-cases.jsonl`, y así sucesivamente.

¡Feliz construcción de conjuntos de datos! Si tienes preguntas o quieres compartir tus mejores prompts, únete a la [comunidad de Discord](https://discord.gg/9gUsc2sNG6). 🎯
