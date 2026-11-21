# Una vista previa en blanco ahora te dice por qué, y una API de Laravel arranca en la pestaña

Pulsas Run. El marco de la vista previa se queda en blanco. O se llena, pero tarda doce segundos, y no sabes si fue la red, el compilador, un CDN de paquetes o tu propio código.

Hasta ahora, el runtime en el navegador te daba muy poco con lo que trabajar. La vista previa se ejecuta bajo una política de seguridad estricta, así que un mapa que carga teselas desde un servidor de terceros, o una fuente desde un CDN, queda bloqueado, y la página simplemente parece rota. Una primera carga lenta se veía igual que una rápida que se había quedado atascada. Y si tu API era de Laravel, `php artisan serve` fallaba antes de atender una sola petición.

BuilderForce WebContainers 2026.11.9 cierra esos huecos. **Una vista previa en blanco o lenta ahora llega con un motivo, y una API de Laravel ahora arranca en la pestaña.**

## Una sola llamada que dice adónde fue el tiempo

`runtime.diagnostics()` devuelve un único informe de carga. Contiene solo lo que el runtime midió:

- **Tiempos de cada fase**: el arranque del runtime, el service worker listo, la carga del compilador y el primer pintado de la vista previa.
- **Tráfico al CDN de paquetes:** cuántas peticiones, cuánto tardaron en total y cuántas fallaron.
- **Peticiones por origen** y las **peticiones más lentas**, etiquetadas por origen y por quién las pidió. Las rutas y las URL se omiten.
- Las **infracciones recientes de la política de seguridad** en la vista previa.
- Si la caché del navegador estaba **fría o caliente**.
- Una lista de lo que **no se pudo medir**, para que un número que falta no se confunda con un cero.

```bf-figure
{
  "kind": "flow",
  "title": "Las cuatro fases que cronometra un informe de carga",
  "steps": [
    { "label": "Arranque del runtime", "note": "El reloj empieza cuando arrancas el runtime. Todas las demás fases se miden desde aquí.", "hue": "make" },
    { "label": "Service worker listo", "note": "El worker que sirve los archivos de la vista previa está instalado y responde.", "hue": "make" },
    { "label": "Carga del compilador", "note": "El compilador esbuild en WebAssembly se descarga y se inicia. Una caché fría se nota aquí primero.", "hue": "run" },
    { "label": "Primer pintado de la vista previa", "note": "La vista previa informa de su primer pintado con contenido. Es el momento en que una persona ve algo.", "hue": "measure" }
  ],
  "caption": "Cada fase lleva una hora de inicio y una duración. Una fase que el navegador no pudo observar aparece como no disponible en lugar de informarse como cero."
}
```

Así, cuando alguien dice que la vista previa va lenta, puedes ver si la descarga del compilador se llevó la mayor parte del tiempo, o el CDN de paquetes, o si la caché simplemente estaba fría.

## Ve exactamente qué bloqueó la política de seguridad

Las vistas previas ejecutan código que tú no escribiste, así que el runtime da a cada una una Content Security Policy estricta. Es el valor por defecto correcto, y también es el motivo más habitual por el que una vista previa aparece en blanco o a medio estilizar.

`runtime.onCspViolation(listener)` ahora le dice a la página anfitriona qué origen se bloqueó y bajo qué directiva: por ejemplo, `img-src` bloqueó `https://tile.openstreetmap.org`. Una dirección bloqueada se reduce a su origen, así que ninguna ruta ni query sale de la vista previa. Las repeticiones se notifican una vez y el total tiene un límite, de modo que una página atrapada en un bucle no puede inundarte.

```bf-figure
{
  "kind": "screen",
  "frame": "Tu página, con el runtime integrado",
  "ratio": 1.6,
  "regions": [
    { "label": "Vista previa", "note": "Una app de mapas sin teselas: la política bloqueó el servidor de teselas", "x": 4, "y": 8, "w": 58, "h": 84, "hue": "muted", "style": "ghost" },
    { "label": "Bloqueado: img-src", "note": "https://tile.openstreetmap.org", "x": 66, "y": 8, "w": 30, "h": 24, "hue": "bad" },
    { "label": "Informe de carga", "note": "Fases, peticiones al CDN, orígenes más lentos, caché fría o caliente", "x": 66, "y": 36, "w": 30, "h": 34, "hue": "measure" },
    { "label": "Solución", "note": "Añadir el origen a la lista de destinos permitidos de la vista previa", "x": 66, "y": 74, "w": 30, "h": 18, "hue": "good" }
  ],
  "caption": "El marco vacío deja de ser un misterio. La infracción nombra el origen y la directiva, y la solución es una línea de configuración."
}
```

¿Estás pasando una app existente a la política? `previewCspMode: 'report-only'` notifica cada infracción sin bloquear nada, para que primero puedas reunir la lista completa. Desactiva la protección, así que es solo para migraciones, y tu servidor tiene que permitirlo a propósito. Builderforce nunca lo activa.

## Tu propio CDN de paquetes, sin página en blanco

Si sirves los paquetes de npm desde tu propio espejo en lugar de esm.sh, el espejo ahora declara sus orígenes y el runtime los añade por ti a la política de la vista previa. Un espejo compatible con esm.sh necesita una sola opción:

```ts
const runtime = await startPreviewRuntime({
  relayUrl: 'https://preview.example.com/__bfwc/relay.html',
  cdn: createEsmShCdnFactory({ origin: 'https://esm.example.com' }),
});
```

Un CDN personalizado que no declaraba orígenes fallaba en silencio: cada importación de paquete se bloqueaba y la vista previa se quedaba en blanco. Ahora el runtime registra un aviso que nombra el problema, una sola vez.

```bf-figure
{
  "kind": "compare",
  "title": "Una vista previa en blanco, antes y después",
  "columns": [
    { "title": "Antes de 2026.11.9", "hue": "muted", "items": ["Un marco blanco y ningún motivo", "Los orígenes bloqueados solo se veían en tu servidor, si recogías informes", "Una carga lenta parecía una atascada", "Un CDN personalizado sin su origen en la lista se rompía en silencio", "php artisan serve fallaba al arrancar"] },
    { "title": "Con 2026.11.9", "hue": "run", "items": ["El origen bloqueado y la directiva, en la página anfitriona", "Un informe de carga: fases, CDN, orígenes, caché", "Modo report-only para pasar una app a la política", "Los orígenes de un CDN personalizado entran en la política, o recibes un aviso", "Una API de Laravel arranca con php artisan serve"] }
  ],
  "caption": "La política es tan estricta como antes. Lo que cambia es que se explica."
}
```

## Una API de Laravel ahora arranca en la pestaña

`php artisan serve` inicia el servidor web integrado de PHP como un proceso aparte. La versión WebAssembly de PHP que se ejecuta en el navegador no puede iniciar procesos de esa forma, así que el propio comando serve de Laravel fallaba antes de que la API respondiera nada. Ahora el runtime lo sirve directamente, como lo haría Laravel, desde el directorio `public/` de la app.

Eso significa que un frontend de Vite, una API de Laravel y una base de datos Postgres arrancan de principio a fin en una sola pestaña: Composer instala los paquetes, se ejecutan las migraciones, la API arranca y el frontend llega a ella por la misma dirección.

```bf-figure
{
  "kind": "flow",
  "title": "Una app de Vite, Laravel y Postgres arrancando en una pestaña",
  "steps": [
    { "label": "Postgres", "note": "Una base de datos Postgres real, alojada en la página.", "hue": "measure", "tag": "en la pestaña" },
    { "label": "composer install", "note": "Instala los paquetes de la API. Su salida termina con su última línea antes de que empiece el siguiente paso.", "hue": "make", "tag": "preparación" },
    { "label": "artisan migrate", "note": "Crea el esquema cuando los paquetes y la base de datos están listos.", "hue": "make", "tag": "preparación" },
    { "label": "artisan serve", "note": "La API de Laravel, lista cuando responde su ruta de salud.", "hue": "run", "tag": "en la pestaña" },
    { "label": "Frontend de Vite", "note": "La página que recorres, que llama a la API en /api.", "hue": "run", "tag": "en la pestaña" }
  ],
  "caption": "Los pasos de preparación también son servicios: cada uno termina antes de que arranquen los servicios que dependen de él, y su registro completo está disponible cuando lo hace."
}
```

Los pasos de preparación recibieron un arreglo más. Cuando `composer install` o `npm install` termina, su registro ahora siempre acaba con su última línea antes de que el siguiente servicio cambie de estado. Si un paso falla, el error que necesitas está en el registro, no cortado justo encima.

## Detalles que facilitan el alojamiento

- **El paquete del runtime de .NET se instala desde npm** como `@seanhogg/builderforce-webcontainers-dotnet`, en la misma versión que el runtime. Cópialo a tus archivos estáticos y apunta el runtime hacia él.
- **Una tabla de todos los recursos que se descargan en tiempo de ejecución.** El README ahora lista cada origen del que descarga el runtime, qué página o worker lo pide, cuándo y cómo alojarlo tú mismo. Si tu sitio tiene una política estricta o no tiene red, ves exactamente qué replicar.

## Dónde encaja en el método

Idea to Real es un arco, **Idea → Make → Run → Measure**, con un ciclo dentro: [Read, Prove, Build](/blog/read-prove-build-the-inner-loop). Leer y probar no cuestan nada, así que la decisión de construir es una decisión de verdad.

Una prueba solo sirve si su respuesta es clara. Lanza un smoke test o una prueba de concepto, obtén una página en blanco, y no podrás saber si falló la idea o falló la fontanería. Un informe de carga y un origen bloqueado con nombre separan las dos cosas: o la app hace lo que describiste, o sabes qué línea de configuración la detuvo.

```bf-figure
{
  "kind": "stack",
  "title": "El arco, con Run y Measure informando de vuelta",
  "bands": [
    { "label": "Idea", "note": "Léela y elige la prueba más barata que valga la pena: un smoke test, una prueba de concepto, un piloto.", "hue": "idea" },
    { "label": "Make", "note": "Construye lo único que pidió la prueba, incluida una API de Laravel.", "hue": "make" },
    { "label": "Run", "note": "Velo arrancar en la pestaña. Si la vista previa está en blanco, se nombra el origen bloqueado.", "hue": "run", "tag": "se explica" },
    { "label": "Measure", "note": "Tiempos de fase y número de peticiones, para que una ejecución lenta lleve un número.", "hue": "measure", "tag": "informe de carga" }
  ],
  "caption": "Una prueba fallida debería ser un hallazgo sobre la idea, no sobre la vista previa."
}
```

## Qué puedes hacer hoy

- **Averiguar por qué una vista previa está en blanco** leyendo el origen bloqueado y la directiva, y luego permitir ese origen.
- **Averiguar por qué una vista previa va lenta** con una llamada que cronometra cada fase y cuenta el tráfico al CDN y a los orígenes.
- **Pasar una app existente a la política** con el modo report-only, y luego volver a aplicarla.
- **Servir paquetes desde tu propio espejo** sin listar su origen a mano.
- **Ejecutar una API de Laravel** con un frontend de Vite y Postgres, de principio a fin, en la pestaña del navegador.
- **Alojar el runtime en un sitio cerrado**, con una lista de todo lo que descarga y el paquete de .NET desde npm.

---

**Lecturas relacionadas:** [BuilderForce WebContainers es código abierto](/blog/builderforce-webcontainers-open-source) · [Tu app full-stack ahora se ejecuta en la pestaña del navegador donde la creaste](/blog/your-full-stack-app-now-runs-in-your-browser-tab) · [Read, Prove, Build: el ciclo interior](/blog/read-prove-build-the-inner-loop)

[Lee el runtime en GitHub](https://github.com/SeanHogg/builderforce-webcontainers), o [abre un canvas](/create), describe una app con una API de Laravel y pulsa Run.
