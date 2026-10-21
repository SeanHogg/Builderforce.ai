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

Es la función estrella de la guía, y es un motor de primera clase en Builderforce. El motor de la Prompt API envuelve la API `LanguageModel` de Chrome: **cero descargas** para la aplicación (el modelo viene con el navegador), ningún presupuesto de VRAM que gestionar y **streaming real de tokens** de serie. Convive con dos motores que ejecutan modelos descargados sobre WebGPU —nuestro propio motor **Bonsai** de 1 bit y **WebLLM**— tras un único contrato `PageEngine`:

```ts
import { createPageEngineSet } from '@seanhogg/builderforce-brain-embedded';

// Bonsai, WebLLM and the Prompt API — one set per page, one fetch shim, one model store.
const engines = createPageEngineSet({
  bfiWorker: {
    create: () => new Worker(new URL('./bfi.worker.ts', import.meta.url), { type: 'module' }),
    wasmUrl: async () => (await import('@seanhogg/bfi-web/wasm-url')).bfiWasmUrl,
  },
});
```

El motor detecta la API, gestiona los estados `downloadable`/`downloading`/`available` que informa el navegador, y cada motor declara su ventana de contexto real, de modo que una conversación se ajusta *antes* de llegar a un modelo local más pequeño.

## 4. La cascada de mejora progresiva

La idea más importante de la guía es arquitectónica: **una interfaz, muchos backends, degradación elegante**. En Builderforce es un único paso de enrutado, `createHostModelStream`: la misma función que ejecutan la aplicación web, la extensión de VS Code y el panel lateral de Chrome:

```ts
import { createHostModelStream } from '@seanhogg/builderforce-brain-embedded';

const stream = createHostModelStream({
  probes: () => engines.probe(),  // what this page can run right now
  fetch: engines.fetch(),         // the engines' one transport
  cloud: () => gatewayStream,     // the terminal tier
});
```

En cada llamada, el orden es:

1. **Un modelo que fijaste** en el selector «En este dispositivo»: se ejecuta aquí, sin más
2. **Primero local**: si un motor listo puede atender la petición, responde en el dispositivo
3. **LLM en la nube**: siempre disponible, y el **respaldo invisible** si un intento local falla

La decisión de «¿qué backend?» vive en un único lugar. Tu interfaz simplemente hace streaming y nunca se ramifica según la disponibilidad.

## 5. Aislamiento en Web Worker

La guía tiene razón: el trabajo pesado nunca debe bloquear el hilo principal; muestrear sobre un vector de logits de 150.000 entradas *por token* entorpece la interfaz. WebLLM se ejecuta en un Web Worker cuando el host lo proporciona, y nuestro motor **Mamba** local —el que entrenas— se ejecuta íntegramente dentro de un worker. Como un `GPUDevice` no puede transferirse a través del límite del worker, el worker aloja todo el motor y el hilo principal habla con él mediante un pequeño protocolo RPC:

```ts
import { initMambaProvider } from '@/lib/mamba-worker-client';

// Off the main thread when the runtime allows it; in-page otherwise.
const mamba = await initMambaProvider({ dModel: 512, numLayers: 8 });
await mamba.train(code, { epochs: 3, onEpochEnd: (epoch, loss) => plot(epoch, loss) });
```

Los eventos de tokens y de progreso por época vuelven como mensajes; el checkpoint entrenado se **transfiere** (no se copia) de vuelta. Y si el entorno no puede crear un worker, recurre al motor dentro de la página: nada se rompe.

## 6. Recuperación de `GPUDevice.lost`

Una pestaña en segundo plano, un reinicio del driver o un portátil que cambia de GPU invalidan en silencio todos los buffers y pipelines que tengas. La guía lo señala; la mayoría de las demos en el navegador lo ignoran. Builderforce se suscribe a la promesa de pérdida del dispositivo en el único punto donde se adquiere el dispositivo. Una pérdida real desmonta el modelo y devuelve el proveedor al estado *no listo*, para que la siguiente llamada se reinicialice limpiamente, mientras que un `destroy()` deliberado se filtra para que nunca se interprete como un fallo.

## 7. Caché de pesos, descargas en streaming y privacidad

Los pesos del modelo se almacenan en caché en **IndexedDB** tras la primera descarga, desde una cadena de varias fuentes (nuestro proxy R2 → CDN de Hugging Face) con progreso en streaming, de modo que un checkpoint de varios gigabytes se descarga una vez, no en cada carga de página. Y la propiedad de privacidad que la guía describe como «un hecho arquitectónico» es exactamente la razón por la que construimos esto: con inferencia local, **tus prompts y tu código nunca salen de la máquina**. No es una promesa de política; la petición de red simplemente no se produce.

## Balance: la lista de la guía frente a Builderforce

| Buena práctica de la guía | Builderforce |
| --- | --- |
| Shaders de cómputo WebGPU | ✅ Kernels WGSL escritos a mano para el SSM Mamba |
| Tokenización/muestreo en WASM | ✅ Tokenizador BPE, entrenado con tu propio corpus |
| Prompt API de Chrome (nivel 1) | ✅ Motor de la Prompt API, streaming real |
| Web-LLM / WebGPU (nivel 2) | ✅ WebLLM y nuestro motor Bonsai de 1 bit, sobre WebGPU |
| Respaldo en la nube (nivel 3) | ✅ Nivel final de la cascada |
| Interfaz uniforme + respaldo | ✅ `createHostModelStream`, un único paso en cada superficie |
| Aislamiento en Web Worker | ✅ WebLLM y el motor Mamba alojados en workers |
| Recuperación de `GPUDevice.lost` | ✅ Gestión de la pérdida del dispositivo en un único punto |
| Caché local de pesos | ✅ IndexedDB, streaming, varias fuentes |
| Detectar la compatibilidad de todo | ✅ Sondeo WebNN → WebGPU → CPU |
| ***Entrenamiento* en el dispositivo** | ✅ **Más allá de la guía**: pase hacia atrás real + AdamW |
| **NPU mediante WebNN** | ✅ **Más allá de la guía** |
| **Memoria de respuestas en el dispositivo** | ✅ **Más allá de la guía**: embeddings SSM en el dispositivo |

## Cómo usarlo

Todo lo anterior está disponible hoy:

- **Las superficies de chat y asistente** obtienen la cascada local primero sin coste: Gemini Nano o un modelo que descargaste desde el selector «En este dispositivo» cuando el navegador puede ejecutarlo, y si no, la nube, con el mismo enrutado en la web, en VS Code y en el panel lateral de Chrome.
- **El trabajo sensible a la privacidad** fija un modelo en el dispositivo, de modo que la petición nunca sale de la máquina.
- **El ajuste fino** se hace en el [panel de entrenamiento de IA](/training): apúntalo a tu código y un descenso de gradiente real con WebGPU produce un checkpoint que nunca toca un servidor.

La guía de SitePoint es el mapa correcto. Builderforce es una plataforma que ya ha recorrido todo el territorio, y ha seguido avanzando, hasta el entrenamiento en el dispositivo, algo que hasta hace poco se suponía que el navegador nunca podría hacer.

*¿Quieres la versión técnica a fondo? Lee [Dentro de la arquitectura de Evermind](/blog/inside-evermind-architecture) y [El ajuste fino LoRA con WebGPU, explicado](/blog/webgpu-lora-explained).*
