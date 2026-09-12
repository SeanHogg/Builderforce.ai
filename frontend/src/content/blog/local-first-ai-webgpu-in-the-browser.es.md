SitePoint publicó hace poco un plano excelente para ejecutar grandes modelos de lenguaje íntegramente dentro del navegador: [*Local-First AI With WebGPU: A Practical Guide for Chrome*](https://www.sitepoint.com/local-first-ai-webgpu-chrome-guide/). Es la explicación más clara que hemos visto de *por qué* la inferencia en el dispositivo por fin es viable y de *qué* tiene que resolver bien una implementación lista para producción.

La leímos como se lee la lista de comprobación de algo que ya has lanzado. Builderforce lleva más de un año ejecutando inferencia —y entrenamiento— con WebGPU en la pestaña del navegador. Así que este artículo hace dos cosas: repasa la arquitectura que recomienda la guía y luego muestra exactamente cómo nuestra plataforma implementa cada punto de esa lista, además de las partes que la guía no cubre.

## El plano, en un párrafo

La guía sostiene que tres avances han hecho realidad la IA local: los **modelos pequeños cuantizados a 4 bits**, **WebGPU estable desde Chrome 113** y el **Gemini Nano integrado** en Chrome, expuesto mediante la Prompt API. Su arquitectura recomendada reparte el trabajo según los puntos fuertes del hardware —shaders de cómputo WebGPU (WGSL) para el pase hacia delante, cargado de multiplicaciones de matrices, y WebAssembly para la tokenización y el muestreo— detrás de una **cascada de mejora progresiva**: Prompt API (nivel 1) → un framework WebGPU como Web-LLM (nivel 2) → respaldo en la nube (nivel 3), todo tras una única interfaz uniforme. Después enumera los imprescindibles operativos: ejecutar la inferencia en un **Web Worker**, precalentar para reducir el tiempo hasta el primer token, **almacenar los pesos en caché** localmente, recuperarse de **`GPUDevice.lost`** y detectar la compatibilidad de todo.

Es una gran lista. Así es como resolvemos cada parte.

## 1. La capa de cómputo: tenemos nuestros propios kernels WGSL

La guía recomienda apoyarse en un framework (Web-LLM, Transformers.js) para mapear las matemáticas del transformer en grupos de trabajo de la GPU. Nosotros bajamos una capa más. El motor de Builderforce incluye **kernels WGSL escritos a mano** para un **modelo de espacio de estados** Mamba: el núcleo de escaneo selectivo (S6) implementado como un escaneo de prefijos paralelo Kogge-Stone que se ejecuta en O(log N) en la GPU, con softplus numéricamente estable y discretización con retención de orden cero.

Y lo decisivo: nuestros kernels implementan el **pase hacia atrás**, no solo el pase hacia delante. Eso significa que no solo *ejecutamos* un modelo en el dispositivo: lo **entrenamos** en el dispositivo, con pasos de gradiente AdamW reales sobre tu propio código, todo dentro de la pestaña. La guía de SitePoint se queda en la inferencia; esta es la capacidad que hace posibles [el aprendizaje «memory-first»](/blog/evermind-self-updating-model) y [el ajuste fino LoRA en el navegador](/blog/webgpu-lora-explained).

## 2. Selección de dispositivo: WebNN → WebGPU → CPU

El artículo trata WebGPU como *la* vía de cómputo. Nosotros la tratamos como la intermedia de tres. Nuestro enrutador de dispositivos sondea, por orden de prioridad:

1. **WebNN**: la API de redes neuronales que puede apuntar a una **NPU** dedicada (Snapdragon X, Apple Neural Engine, Intel AI Boost) antes de tocar la GPU.
2. **WebGPU**: la vía de GPU de alto rendimiento en la que se centra la guía.
3. **CPU (WASM SIMD)**: el respaldo honesto.

Un sondeo, una decisión, compartida por todos los consumidores: ningún componente vuelve a calcular por su cuenta «¿puede este navegador ejecutarlo?». Y deliberadamente **no nos inventamos una cifra de VRAM**: WebGPU no expone la memoria real, así que devolvemos `null` en lugar de confundir un límite de especificación de 2 GB con una tarjeta de 2 GB y bloquear por error una GPU de 16 GB.

## 3. Nivel 1: el Gemini Nano integrado en Chrome

Es la función estrella de la guía, y ahora es un backend de primera clase en Builderforce. Nuestro `PromptApiModelProvider` envuelve la API `LanguageModel` de Chrome: **cero descargas** para la aplicación (el modelo viene con el navegador), ningún presupuesto de VRAM que gestionar y **streaming real de tokens** de serie:

```ts
import { createInferenceProvider } from '@/lib/model-provider';

const ai = createInferenceProvider({
  projectId,
  systemPrompt: 'You are a concise coding assistant.',
});
await ai.init();

// Streams tokens the instant the built-in model produces them.
await ai.stream('Refactor this function', context, (token) => {
  append(token);
});
```

El proveedor detecta si la API está disponible, gestiona los estados `downloadable`/`downloading`/`available` que informa el navegador y expone el **presupuesto de tokens** restante de la sesión (`inputUsage` / `inputQuota`) para que quien lo llame pueda recortar el historial *antes* de que se agote la ventana de contexto fija.

## 4. La cascada de mejora progresiva

La idea más importante de la guía es arquitectónica: **una interfaz, muchos backends, degradación elegante**. Es exactamente lo que devuelve `createInferenceProvider`: un único `ModelProvider` que internamente ordena:

1. **Prompt API de Chrome** (local, sin configuración): cuando el navegador la expone
2. **Tu modelo en el dispositivo** (un SSM Mamba entrenado, opcionalmente alojado en un worker): cuando tienes uno
3. **LLM en la nube**: siempre disponible, el respaldo final

`init()` elige el backend de mayor prioridad que esté listo; `generate` y `stream` se enrutan a él y **pasan de forma transparente** al siguiente nivel listo si lanza un error. La decisión de «¿qué backend?» vive en un único lugar. Tu interfaz solo habla con un `ModelProvider` y nunca se ramifica por disponibilidad.

## 5. Aislamiento en Web Worker

La guía tiene razón en que la generación nunca debe bloquear el hilo principal: muestrear sobre un vector de logits de 150k entradas *por token* entrecorta la interfaz. Por eso todo el motor puede ejecutarse en un **Web Worker**. Como un `GPUDevice` no puede transferirse a través del límite del worker, el worker aloja el motor por completo y el hilo principal se comunica con él mediante un pequeño protocolo RPC:

```ts
import { createLocalFirstProvider } from '@/lib/mamba-worker-client';

const ai = createLocalFirstProvider({
  projectId,
  includeLocalMamba: true, // Tier 2 runs entirely in a Web Worker
});
await ai.init();
```

Los eventos de tokens y de progreso por época vuelven como mensajes; el checkpoint entrenado se **transfiere** (no se copia) de vuelta. Y si el entorno no puede lanzar un worker, el proveedor informa de que no está listo y la cascada simplemente pasa al siguiente nivel: nada se rompe.

## 6. Recuperación de `GPUDevice.lost`

Una pestaña en segundo plano, un reinicio del driver o un portátil que cambia de GPU invalidan en silencio todos los buffers y pipelines que tengas. La guía lo señala; la mayoría de las demos en el navegador lo ignoran. Builderforce se suscribe a la promesa de pérdida del dispositivo en el único punto donde se adquiere el dispositivo. Una pérdida real desmonta el modelo y devuelve el proveedor al estado *no listo*, para que la siguiente llamada se reinicialice limpiamente, mientras que un `destroy()` deliberado se filtra para que nunca se interprete como un fallo.

## 7. Caché de pesos, descargas en streaming y privacidad

Los pesos del modelo se almacenan en caché en **IndexedDB** tras la primera descarga, desde una cadena de varias fuentes (nuestro proxy R2 → CDN de Hugging Face) con progreso en streaming, de modo que un checkpoint de varios gigabytes se descarga una vez, no en cada carga de página. Y la propiedad de privacidad que la guía describe como «un hecho arquitectónico» es exactamente la razón por la que construimos esto: con inferencia local, **tus prompts y tu código nunca salen de la máquina**. No es una promesa de política; la petición de red simplemente no se produce.

## Balance: la lista de la guía frente a Builderforce

| Buena práctica de la guía | Builderforce |
| --- | --- |
| Shaders de cómputo WebGPU | ✅ Kernels WGSL escritos a mano para el SSM Mamba |
| Tokenización/muestreo en WASM | ✅ Tokenizador BPE, entrenado con tu propio corpus |
| Prompt API de Chrome (nivel 1) | ✅ `PromptApiModelProvider`, streaming real |
| Web-LLM / WebGPU (nivel 2) | ✅ Mamba en el dispositivo, opcionalmente alojado en un worker |
| Respaldo en la nube (nivel 3) | ✅ Nivel final de la cascada |
| Interfaz uniforme + respaldo | ✅ `createInferenceProvider` |
| Aislamiento en Web Worker | ✅ Motor completo alojado en un worker |
| Recuperación de `GPUDevice.lost` | ✅ Gestión de la pérdida del dispositivo en un único punto |
| Caché local de pesos | ✅ IndexedDB, streaming, varias fuentes |
| Detectar la compatibilidad de todo | ✅ Sondeo WebNN → WebGPU → CPU |
| ***Entrenamiento* en el dispositivo** | ✅ **Más allá de la guía**: pase hacia atrás real + AdamW |
| **NPU mediante WebNN** | ✅ **Más allá de la guía** |
| **Caché semántica de respuestas** | ✅ **Más allá de la guía**: embeddings SSM en el dispositivo |

## Cómo usarlo

Todo lo anterior está disponible hoy:

- **Las superficies de chat / asistente** llaman a `createInferenceProvider({ projectId })` y obtienen la cascada local sin esfuerzo: Gemini Nano cuando el navegador lo tiene y la nube en caso contrario, con una sola línea de código.
- **El trabajo sensible en materia de privacidad** activa `includeLocalMamba` para mantener la inferencia íntegramente en el dispositivo, en un Web Worker.
- **El ajuste fino** se hace en el [panel de entrenamiento de IA](/training): apúntalo a tu código y un descenso de gradiente real con WebGPU produce un checkpoint que nunca toca un servidor.

La guía de SitePoint es el mapa correcto. Builderforce es una plataforma que ya ha recorrido todo el territorio, y ha seguido avanzando, hasta el entrenamiento en el dispositivo, algo que hasta hace poco se suponía que el navegador nunca podría hacer.

*¿Quieres la versión técnica a fondo? Lee [Dentro de la arquitectura de Evermind](/blog/inside-evermind-architecture) y [El ajuste fino LoRA con WebGPU, explicado](/blog/webgpu-lora-explained).*
