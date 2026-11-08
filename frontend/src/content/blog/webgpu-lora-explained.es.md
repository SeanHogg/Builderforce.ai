La mayoría de los flujos de fine-tuning de IA se parecen: subes tus datos a un proveedor en la nube, levantas una costosa instancia A100, esperas a que termine el entrenamiento y descargas los pesos. Builderforce descarta ese manual por completo.

Así ejecutamos el entrenamiento LoRA directamente en la pestaña de tu navegador con compute shaders de WebGPU.

![Descomposición LoRA: los pesos base congelados W₀ más el producto de dos pequeñas matrices adaptadoras entrenables B y A igualan los pesos adaptados W, con tarjetas de datos para ~10.000× menos parámetros entrenables, hasta 2B de parámetros en el navegador y cero facturas de GPU en la nube](/blog/webgpu-lora.svg)

## Contexto: ¿qué es LoRA?

**LoRA** (Low-Rank Adaptation) es una técnica de fine-tuning eficiente en parámetros introducida por Hu et al. en 2021. En lugar de actualizar todos los pesos de un modelo de lenguaje grande, LoRA congela los pesos originales e inyecta pequeñas **matrices adaptadoras** en cada capa de atención.

Formalmente, para una matriz de pesos `W₀ ∈ ℝᵐˣⁿ`, LoRA añade:

```
W = W₀ + BA
```

donde `B ∈ ℝᵐˣʳ` y `A ∈ ℝʳˣⁿ` con rango `r ≪ min(m, n)`.

Entrenar solo `B` y `A` reduce los parámetros entrenables 10 000× en un modelo de 7B con rango 8, lo que hace viable el entrenamiento en el navegador.

## ¿Por qué WebGPU?

WebGPU es el sucesor moderno de WebGL, diseñado específicamente para cómputo en GPU. A diferencia de WebGL, que se concibió en torno al pipeline de rasterización, WebGPU expone compute shaders puros mediante WGSL, perfectos para las multiplicaciones de matrices que dominan el entrenamiento de redes neuronales.

Ventajas clave frente a una alternativa en CPU:
- **Operaciones matriciales en paralelo**: miles de hilos de shader se ejecutan simultáneamente
- **Memoria compartida**: GEMM por teselas con caché en el chip
- **Sin salida de datos**: los pesos nunca salen de tu máquina

## El pipeline de entrenamiento de Builderforce

```
Dataset (JSONL) → Tokeniser → Batching → Forward Pass → Loss → Backward Pass → Weight Update → Repeat
```

Cada paso se ejecuta como un pipeline de cómputo de WebGPU:

1. **Tokenización**: se ejecuta en la CPU mediante el tokenizador WASM de Transformers.js
2. **Pasada hacia delante**: las capas de atención y feed-forward se despachan a shaders de GPU
3. **Cálculo de la pérdida**: entropía cruzada sobre la distribución del vocabulario
4. **Pasada hacia atrás**: los gradientes se calculan mediante autodiff en modo inverso en WGSL
5. **Actualización AdamW**: los pesos adaptadores LoRA `A` y `B` se actualizan con momento

## SharedArrayBuffer y COOP/COEP

WebGPU requiere `SharedArrayBuffer` para transferir datos de tensores entre la CPU y la GPU sin copiarlos. Esta API está condicionada a cabeceras de aislamiento de origen cruzado:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

Builderforce establece estas cabeceras en cada página, habilitando `SharedArrayBuffer` sin dejar de permitir fuentes e imágenes de origen cruzado.

## Garantías de privacidad

Como el entrenamiento ocurre por completo en tu navegador:

- Tus datos de entrenamiento **nunca salen de tu máquina**
- Los pesos de tu modelo **nunca tocan nuestros servidores** (salvo que los publiques explícitamente)
- No podemos ver, registrar ni monetizar tus datos de fine-tuning

Los pesos del adaptador LoRA se serializan desde los búferes de la GPU y pueden descargarse como un archivo `.safetensors` o enviarse a Cloudflare R2 bajo tu cuenta.

## Limitaciones

El entrenamiento en el navegador tiene restricciones:

| Factor | Límite del navegador | Equivalente en la nube |
|--------|--------------|-----------------|
| Tamaño del modelo | ~2B parámetros | Ilimitado |
| VRAM | Compartida con el SO (~8 GB) | 40–80 GB |
| Velocidad de entrenamiento | ~50 tok/s | ~5 000 tok/s |
| Tamaño de lote | 1–4 | 32–256 |

Para modelos más grandes o iteraciones más rápidas, puedes exportar tu dataset y continuar el entrenamiento en cualquier plataforma estándar: Builderforce no se interpone.

## Conclusión

El fine-tuning LoRA con WebGPU en el navegador no es un truco: es una forma práctica de personalizar modelos pequeños para tareas específicas sin infraestructura en la nube ni preocupaciones de privacidad de datos. ¡Pruébalo en [tu próximo proyecto](/dashboard)!
