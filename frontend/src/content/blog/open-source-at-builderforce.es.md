Las partes de Builderforce que se ejecutan en tu máquina o en tu navegador son las que deberías poder leer. Tocan tus archivos, tus claves, tus modelos y las sesiones de tus usuarios. «Confía en nosotros» es una mala respuesta para todo eso, y la mejor respuesta es el código fuente.

Por eso los runtimes sobre los que está construido Builderforce son código abierto con licencia MIT. Son cuatro, y cada uno es lo que el producto ejecuta de verdad, no una demo recortada de él. Las dos bibliotecas no necesitan cuenta; las dos apps de escritorio inician sesión en Builderforce para las partes que viven en la nube. Los cuatro están en [builderforce.ai/open-source](/open-source).

```bf-figure
{
  "kind": "stack",
  "title": "Cuatro proyectos, una plataforma encima",
  "bands": [
    { "label": "BuilderForce WebContainers", "note": "Un runtime de desarrollo en el navegador: vista previa, build, comprobación de tipos, Node, npm y una shell, sin COOP/COEP y sin límite de sesiones.", "hue": "make", "tag": "TypeScript · npm" },
    { "label": "BuilderForce Memory", "note": "Memoria SSM persistente y entrenable en el navegador para cualquier agente, una caché semántica que recorta el gasto en tokens y un servidor MCP.", "hue": "idea", "tag": "TypeScript · npm" },
    { "label": "BuilderForce Inference", "note": "Synapse, la app de escritorio, y bfi, un motor nativo que ejecuta modelos en tu propia máquina.", "hue": "run", "tag": "Rust" },
    { "label": "BuilderForce Spawn", "note": "Crea juegos de Roblox hablando: una app de escritorio y un puente con Roblox Studio.", "hue": "reach", "tag": "Rust" }
  ],
  "caption": "Los cuatro son MIT. Las bibliotecas no necesitan cuenta; las apps de escritorio inician sesión para las partes en la nube."
}
```

## BuilderForce WebContainers: el runtime debajo de cada vista previa

**Qué es.** Un runtime de desarrollo en el navegador, abierto y con el que puedes hacer un fork. Entrégale un proyecto como archivos y sirve una vista previa en vivo: Vite con React, Vue o Svelte, Create React App y sitios estáticos. Compila para despliegue (`runtime.build()`) y comprueba tipos (`createChecker()`) en la página, y ejecuta programas Node, `npm install` desde el registro real y una shell interactiva, con un Web Worker por proceso.

**Qué vale.** Necesita un contexto seguro y un service worker, nada más. Sin cabeceras COOP/COEP, las ventanas de inicio de sesión, los marcos de pago y los embeds de tu app siguen funcionando. Sin límite de sesiones, abrir una vista previa no cuesta nada. Con puertos intercambiables, puedes cambiar el compilador o el CDN de paquetes sin hacer un fork del núcleo. Sustituyó a StackBlitz WebContainers en cada vista previa del lienzo, cada Publicar y cada Comprobar de Builderforce.

**Con claridad sobre sus límites.** Los complementos nativos, los scripts de instalación y los servidores de desarrollo de Next.js, Nuxt, SvelteKit, Remix y Astro no se ejecutan; el runtime detecta esos proyectos y explica por qué. Los WebSockets y las respuestas en streaming están en la hoja de ruta.

[Lee la página del proyecto](/open-source/builderforce-webcontainers) · [Lee el anuncio](/blog/builderforce-webcontainers-open-source) · [GitHub](https://github.com/SeanHogg/builderforce-webcontainers)

## BuilderForce Memory: memoria que cualquier agente puede conservar

**Qué es.** Un framework para dar a cualquier agente de IA una memoria persistente que se puede entrenar en el navegador. Tres paquetes: un motor de kernels de espacio de estados Mamba en WebGPU, con entrenador y tokenizador (`@seanhogg/builderforce-memory-engine`); un runtime con puentes para Anthropic, OpenAI y Fetch, un enrutador de inferencia, destilación en línea y el almacén de memoria (`@seanhogg/builderforce-memory`); y un servidor MCP con un instalador que lo registra en Claude Code, Claude Desktop, Cursor, Windsurf, VS Code, Cline, Gemini CLI y Codex CLI (`@seanhogg/builderforce-memory-mcp`).

**Qué vale.** Facturas de tokens más bajas y un conocimiento que se mantiene al día. Una caché semántica reutiliza una respuesta cuando un prompt nuevo es una paráfrasis de otro ya respondido, así que el modelo de frontera ni siquiera se llama. La cognición write-through sustituye un hecho obsoleto cuando uno más nuevo está respaldado por evidencia, en lugar de acumular ambos para que alguien los concilie. Es la capa de memoria de Evermind en Builderforce, y es neutral respecto al proveedor, así que es igual de útil bajo un agente que nunca ha oído hablar de nosotros.

[Lee la página del proyecto](/open-source/builderforce-memory) · [GitHub](https://github.com/SeanHogg/builderforce-memory)

## BuilderForce Inference: modelos en tu propia máquina

**Qué es.** Synapse, la app de escritorio de Builderforce, y el runtime de IA local que hay debajo. `bfi` es un motor nativo escrito en Rust que lee modelos GGUF, sirve APIs HTTP compatibles con OpenAI, Anthropic y Ollama, y se ejecuta en tu hardware. Synapse lo supervisa, así que no hace falta Ollama. El mismo espacio de trabajo incluye un índice de código, un host MCP para conectores, un cliente de memoria Evermind y secretos guardados en el almacén de credenciales del sistema operativo.

**Qué vale.** El trabajo privado sigue siendo privado. Los modelos locales responden a tu editor y a tus scripts sin llamadas de red, y lo que Evermind aprende en tu máquina se queda ahí salvo que lo publiques. La vía de CPU ya está disponible; no hemos afirmado paridad de GPU con llama.cpp, y el README lo dice.

[Lee la página del proyecto](/open-source/builderforce-inference) · [GitHub](https://github.com/SeanHogg/builderforce-inference)

## BuilderForce Spawn: juegos de Roblox hablando

**Qué es.** Spawn, una app de escritorio para creadores de Roblox, y el puente que la conecta con Roblox Studio. Describe el juego y construye las piezas, el Luau y la interfaz dentro de Studio. Inicia sesión en Builderforce mediante el cliente compartido de BuilderForce Inference.

**Qué vale.** Una sola cosa que instalar, en lugar de una app, un plugin, un servidor local y una herramienta de sincronización. Y como es abierto, los padres, las escuelas y los creadores que quieran saber exactamente qué hace un constructor para creadores jóvenes pueden leerlo.

[Lee la página del proyecto](/open-source/builderforce-spawn) · [GitHub](https://github.com/SeanHogg/builderforce-spawn)

## Por su cuenta o en Builderforce

```bf-figure
{
  "kind": "compare",
  "title": "El mismo código, dos formas de usarlo",
  "columns": [
    { "title": "Por su cuenta", "hue": "muted", "items": ["Instálalo desde npm o cargo, o clónalo desde GitHub", "MIT: haz un fork, publícalo, véndelo", "Lee cada línea que se ejecuta de tu lado", "Alójalo tú y el resultado es tuyo"] },
    { "title": "En Builderforce", "hue": "make", "items": ["Ya conectado al lienzo, a Studio, al Brain y a la app de escritorio", "Agentes, tableros, aprobaciones y el marketplace encima", "Memoria compartida entre tu app web, tus agentes y tu máquina", "Publica en tu propia dirección en un paso"] }
  ],
  "caption": "Aquí el código abierto no es una edición de prueba. El código de GitHub es el código que ejecuta el producto."
}
```

## Dónde encaja en el método

El trabajo en Builderforce sigue un arco, **Idea → Make → Run → Measure**, y cada acto pasa por el mismo bucle interno: [Read, Prove, Build](/blog/read-prove-build-the-inner-loop). Cada proyecto lleva una parte distinta.

- **Make** se ejecuta sobre BuilderForce WebContainers. Una idea se convierte en una app en marcha en la pestaña, y **Prove** sigue siendo gratis porque arrancar un prototipo no cuesta nada.
- **Run** llega a tu máquina con BuilderForce Inference. Un modelo que ejecutas en local responde sin contador, así que dejar un agente en marcha es una decisión de tiempo, no de dinero.
- **Measure** alimenta a BuilderForce Memory. Lo que funcionó se recuerda, una pregunta repetida se responde desde la memoria y la siguiente **Idea** parte de lo que enseñó la anterior.
- **Make** para juegos es Spawn: el mismo bucle, dentro de Roblox Studio.

Ser código abierto no cambia el método. Cambia quién puede comprobar el trabajo: cada acto que se ejecuta de tu lado ejecuta código que puedes leer.

## Cómo empezar

- Explora los cuatro en [builderforce.ai/open-source](/open-source).
- Incrusta el runtime: `npm install @seanhogg/builderforce-webcontainers`.
- Da memoria a tu agente: `npm install @seanhogg/builderforce-memory`, o instala el servidor MCP en las herramientas que ya usas.
- Ejecuta modelos en local: `cargo install --git https://github.com/SeanHogg/builderforce-inference bfi`.
- Abre una incidencia o envía un pull request. Cada repositorio mantiene una hoja de ruta con lo siguiente.

---

**Lecturas relacionadas:** [BuilderForce WebContainers es código abierto](/blog/builderforce-webcontainers-open-source) · [Synapse ya ejecuta modelos por sí mismo](/blog/synapse-runs-models-itself) · [Spawn: crea juegos de Roblox hablando](/blog/build-roblox-games-by-talking)

[Abre un lienzo](/create) y mira el runtime en acción.
