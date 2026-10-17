Cada app que construyes en un lienzo de Builderforce se ejecuta en tu navegador antes que en ningún otro sitio. Hasta este mes, lo que la ejecutaba no era nuestro.

Usábamos StackBlitz WebContainers (`@webcontainer/api`). Es una tecnología impresionante y fue la forma correcta de empezar. También venía con cuatro limitaciones que se hacían más difíciles de sobrellevar cuanto más hacía el lienzo:

- **Una licencia propietaria.** El plan gratuito es no comercial y exige atribución. Un runtime que está debajo de un producto comercial necesita un acuerdo comercial, y cada cliente que quería autoalojarse heredaba esa pregunta.
- **Aislamiento entre orígenes.** Exige que la página anfitriona se sirva con las cabeceras COOP y COEP. Esas cabeceras son justo las que rompen lo que una app real incrusta: ventanas emergentes de inicio de sesión, marcos de pago, reproductores de vídeo, analítica y cualquier script de terceros que no devuelva las cabeceras correctas.
- **Límites de sesiones.** 25.000 sesiones de API al mes en el plan gratuito. Un lienzo que abre una vista previa cada vez que alguien mira una app gasta sesiones muy rápido.
- **Sin forma de entrar.** Cuando una vista previa fallaba dentro del runtime, podíamos reportarlo y esperar. No podíamos leer el código, arreglarlo ni hacer un fork.

Así que construimos el nuestro, y hoy es código abierto con licencia MIT: **BuilderForce WebContainers**, en [GitHub](https://github.com/SeanHogg/builderforce-webcontainers) y en npm como [`@seanhogg/builderforce-webcontainers`](https://www.npmjs.com/package/@seanhogg/builderforce-webcontainers).

## Lo que puedes hacer con él ahora

Entrégale un proyecto como archivos y sirve una vista previa en vivo en un iframe, con TypeScript, JSX, CSS, JSON y paquetes de npm funcionando como en Vite. Todo se ejecuta en el navegador del usuario.

- **Previsualiza apps frontend.** Vite con React, Vue o Svelte, Create React App y sitios estáticos. Las ediciones recargan todas las vistas previas abiertas del proyecto; no hay nada que reiniciar.
- **Compila para despliegue en la página.** `runtime.build()` es `npm run build` sin servidor. Devuelve un sitio estático empaquetado, minificado y con hash de contenido que puedes subir a cualquier parte.
- **Comprueba tipos en la página.** `createChecker()` ejecuta TypeScript en un Web Worker sobre el propio tsconfig del proyecto y devuelve los diagnósticos como datos simples.
- **Ejecuta programas Node.** `npm install` desde el registro real de npm, scripts de Node, servidores al estilo Express en puertos virtuales y una shell interactiva `bfsh` para un terminal. Cada proceso tiene su propio Web Worker, así que un bucle ocupado nunca congela la página y `kill()` siempre funciona.
- **Aísla el código no fiable.** En modo relay, las vistas previas y los procesos se ejecutan en un origen separado, así que el código escrito por IA y los paquetes de npm arbitrarios nunca comparten las cookies ni el almacenamiento de tu app.
- **Haz un fork.** El compilador, el CDN de paquetes y el transporte son puertos. Cambia esbuild por SWC, o esm.sh por tu propio espejo, sin parchear el núcleo.

```bf-figure
{
  "kind": "compare",
  "title": "Los dos runtimes, lado a lado",
  "columns": [
    { "title": "StackBlitz WebContainers", "hue": "muted", "items": ["Licencia propietaria; el plan gratuito es no comercial", "25.000 sesiones de API al mes en el plan gratuito", "Exige COOP y COEP en la página anfitriona", "Compilador y origen de paquetes fijos", "Build y comprobación de tipos ejecutando npm run build y tsc en el contenedor", "Node, npm y una shell"] },
    { "title": "BuilderForce WebContainers", "hue": "make", "items": ["MIT: haz un fork, publícalo, véndelo", "Sin límite de sesiones", "No requiere aislamiento entre orígenes; los embeds siguen funcionando", "Puertos intercambiables para el compilador, el CDN de paquetes y el transporte", "runtime.build() y createChecker() en el navegador", "Node, npm y una shell, un Web Worker por proceso"] }
  ],
  "caption": "Lo que necesita el nuestro: un contexto seguro (https o localhost) para el service worker. Nada más."
}
```

## Cómo funciona

No hay empaquetado durante el desarrollo. El runtime funciona como el servidor de desarrollo de Vite, con un service worker en lugar de la red.

```bf-figure
{
  "kind": "flow",
  "title": "De los archivos a una vista previa en marcha",
  "steps": [
    { "label": "Montar", "note": "El proyecto vive en un sistema de archivos virtual dentro de la página. Escribir un archivo es una edición; no hay disco.", "hue": "idea" },
    { "label": "Compilar por archivo", "note": "Cuando la vista previa pide src/App.tsx, se compila solo ese archivo con esbuild-wasm y se sirve como módulo ES nativo.", "hue": "make" },
    { "label": "Resolver paquetes", "note": "Las importaciones sin ruta se convierten en URLs de esm.sh, fijadas desde package.json y sin duplicados, así que hay un solo React.", "hue": "make" },
    { "label": "Servir", "note": "Un service worker responde a las peticiones del iframe preguntando a la página, así que la vista previa carga como cualquier web.", "hue": "run", "tag": "en la pestaña" }
  ],
  "caption": "El arranque es inmediato y una edición recompila un archivo. Los navegadores matan los service workers inactivos; cuando ocurre, el worker pide a las páginas abiertas que se vuelvan a conectar en lugar de hacer fallar la petición."
}
```

Los programas Node siguen otro camino. `runtime.run('node', …)` inicia un Web Worker con una instantánea de los archivos y adaptadores para `fs`, `http`, `child_process` y el resto de módulos centrales de Node; las escrituras se sincronizan con todos los demás procesos. Un servidor que llama a `listen(3000)` se responde a través del mismo service worker, y `onServerListening` entrega su URL al host. Cada proceso se devuelve como un `RuntimeProcess`: un flujo de salida combinado, `stdin`, `wait()` para el código de salida, `kill()` y `resizeTerminal()`.

## Lo que impulsa en Builderforce

```bf-figure
{
  "kind": "screen",
  "frame": "Una app en el lienzo, ejecutándose sobre BuilderForce WebContainers",
  "ratio": 1.62,
  "regions": [
    { "label": "Vista previa", "note": "Servida desde preview.builderforce.ai, aislada de tu sesión", "x": 4, "y": 8, "w": 58, "h": 62, "hue": "make" },
    { "label": "Terminal", "note": "bfsh: npm, npx, node, pipes", "x": 4, "y": 74, "w": 58, "h": 20, "hue": "run" },
    { "label": "Comprobar", "note": "Tipos, build y lint, con los fallos enviados al agente", "x": 65, "y": 8, "w": 31, "h": 40, "hue": "prove" },
    { "label": "Publicar", "note": "runtime.build() a un sitio estático en tu dirección", "x": 65, "y": 52, "w": 31, "h": 42, "hue": "accent" }
  ],
  "caption": "Un solo runtime detrás de los cuatro. Nada de esto pide al navegador aislamiento entre orígenes, así que la app que previsualizas se comporta como la app que publicas."
}
```

- **Vistas previas del lienzo.** La superficie de app y Studio ejecutan cada proyecto con él, en modo relay: la vista previa vive en `preview.builderforce.ai`, un origen separado, así que el código que escribió un agente nunca toca tus cookies ni tu almacenamiento de Builderforce.
- **Publicar.** Publicar compila el sitio en tu navegador a partir de los archivos del proyecto y sube la salida estática a tu subdominio. La vista previa, y todo lo montado en ella, queda intacta.
- **Comprobar.** Comprobar revisa los tipos y compila el proyecto desde sus archivos sin instalar nada, y después ejecuta el propio `npm run lint` del proyecto en el runtime de Node cuando lo tiene. Cada paso fallido vuelve al agente como algo que arreglar.
- **Errores.** Los errores no capturados en la vista previa se envían a la página anfitriona; así una app rota llega al asistente que la escribió, en lugar de quedarse ahí aparentando estar terminada.

## Lo que todavía no hace

Preferimos decirlo antes de que lo descubras:

- **Complementos nativos y scripts de instalación.** Los complementos `.node` no pueden cargarse en un navegador y `postinstall` se omite. Los paquetes con alternativa en WebAssembly (esbuild-wasm, @swc/wasm) funcionan; los que solo distribuyen binarios nativos (sharp, better-sqlite3), no.
- **Servidores de desarrollo de Next.js, Nuxt, SvelteKit, Remix y Astro.** Hoy necesitan binarios nativos. El runtime detecta estos proyectos y los rechaza explicando el motivo, para que el anfitrión pueda recurrir a otro runtime en lugar de mostrar una vista previa rota.
- **WebSockets y respuestas en streaming** desde un servidor dentro del runtime. Por ahora las respuestas se almacenan completas antes de enviarse.
- **`execSync` y `spawnSync`.** Bloquear un worker a la espera de otro requeriría aislamiento entre orígenes, y este runtime se niega a exigirlo.

Cada uno de estos puntos está en la [hoja de ruta](https://github.com/SeanHogg/builderforce-webcontainers/blob/main/ROADMAP.md) pública, más o menos en el orden en que vale la pena resolverlos.

## Inicio rápido

Sirve el service worker del paquete en `/__bfwc/sw.js` y después arranca, monta y previsualiza:

```ts
import { startPreviewRuntime } from '@seanhogg/builderforce-webcontainers';

const runtime = await startPreviewRuntime({ serviceWorkerUrl: '/__bfwc/sw.js', id: 'my-project' });
runtime.writeTree({
  'package.json': JSON.stringify({ dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' } }),
  'index.html': '<div id="root"></div><script type="module" src="/src/main.tsx"></script>',
  'src/main.tsx': `import { createRoot } from 'react-dom/client';
createRoot(document.getElementById('root')!).render(<h1>Hello</h1>);`,
});

if (runtime.profile().supported) iframe.src = runtime.url;
runtime.onError((e) => console.warn('preview crashed:', e.message));

// Ship it: a static site with hashed assets, built in the page.
const { files } = await runtime.build({ base: './' });
```

Si el código que previsualizas lo ha escrito una IA o incluye paquetes arbitrarios, sirve los archivos de relay desde un origen separado y pasa `relayUrl` en lugar de `serviceWorkerUrl`. El [README](https://github.com/SeanHogg/builderforce-webcontainers#readme) explica el modo relay, la comprobación de tipos, Vue y Svelte, y el runtime de Node.

Cada vista previa muestra una pequeña insignia «Built with Builderforce.ai». No es una condición de la licencia, y `attribution: false` la desactiva. Si el runtime te ahorra dinero, dejarla activada es la forma de financiar el proyecto.

## Dónde encaja en el método

El trabajo en Builderforce sigue un arco, **Idea → Make → Run → Measure**, y cada acto pasa por el mismo bucle interno: [Read, Prove, Build](/blog/read-prove-build-the-inner-loop).

```bf-figure
{
  "kind": "flow",
  "title": "Un runtime, tres actos del arco",
  "steps": [
    { "label": "Make", "note": "La vista previa en la pestaña: una edición recompila un archivo y todas las vistas previas abiertas se recargan.", "hue": "make" },
    { "label": "Comprobar", "note": "Tipos, build y lint antes de publicar nada, con los fallos devueltos al agente.", "hue": "prove" },
    { "label": "Run", "note": "Publicar compila en el navegador y pone un sitio estático en tu dirección.", "hue": "run" },
    { "label": "Measure", "note": "Los errores de la vista previa se reportan a la página, así que la primera evidencia llega antes que el primer usuario.", "hue": "measure" }
  ],
  "caption": "Arrancar el runtime no cuesta nada, y eso es lo que mantiene barato Prove: un prototipo que funciona son unos segundos en la pestaña, no un contenedor."
}
```

El runtime vive en **Make**, y cambia cómo se siente **Prove**. Probar una idea con un prototipo en marcha antes significaba esperar a un contenedor o a un despliegue. Ahora el prototipo arranca en la pestaña, no cuesta nada ejecutarlo y no tiene contador de sesiones, así que probar la segunda idea es tan barato como la primera.

**Build** gana una puerta. Comprobar ejecuta la misma comprobación de tipos y el mismo build que hará Publicar, así que el paso de **Make** a **Run** es un resultado que puedes leer, no una esperanza.

Y como el runtime es MIT, nada de esto es una dependencia opaca. Si una vista previa se comporta mal, el código que la ejecutó está en GitHub.

## Lo que puedes hacer hoy

- **Construye una app en el lienzo** y mírala ejecutarse en la pestaña, sin cabeceras que configurar y sin instalar nada.
- **Incrusta el runtime en tu propio producto.** Un paquete, un service worker, MIT.
- **Ejecuta Node en la pestaña.** `runtime.run('npm', ['install'])` y luego `node server.js`; `onServerListening` te da la URL para el iframe.
- **Lee la hoja de ruta y envía un pull request.** Lo siguiente: lint en el worker de comprobación, recarga de módulos en caliente y preprocesadores de estilos.

---

**Lecturas relacionadas:** [Código abierto en Builderforce](/blog/open-source-at-builderforce) · [La app de tu lienzo ya es un proyecto real](/blog/your-canvas-app-is-a-real-project) · [El IDE en el navegador](/blog/in-browser-ide-and-collaboration)

[Mira todo lo que publicamos como código abierto](/open-source) o [lee la página del runtime](/open-source/builderforce-webcontainers).
