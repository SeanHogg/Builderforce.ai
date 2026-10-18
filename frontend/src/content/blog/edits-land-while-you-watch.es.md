# Los cambios llegan mientras miras: actualizaciones en caliente, hojas de estilo reales y los frameworks que ya usas

Cada vez que la vista previa se recarga, pierdes tu sitio.

Estabas en la tercera pantalla de un flujo de pago, con un formulario a medio rellenar y un modal abierto, y cambiaste un color. La página se recargó, el formulario se vació y volviste a hacer clic hasta llegar allí para ver si el color estaba bien. Multiplica eso por cada pequeño cambio de una tarde y la mayor parte de tu tiempo se va en volver a donde estabas.

Detrás de ese hueco había otro. Muchos proyectos reales nunca llegaban a la vista previa. Un `styles.scss`, un `Button.module.css`, un `import 'some-library/dist/styles.css'` o una app de Next.js, y la vista previa fallaba o mostraba en silencio la página sin sus estilos.

Esta versión cierra los dos huecos.

## Los cambios se aplican en su sitio

```bf-figure
{
  "kind": "compare",
  "title": "Cambiar un color",
  "columns": [
    { "title": "Antes", "hue": "muted", "items": ["Se recarga toda la página", "El formulario que rellenabas vuelve a estar vacío", "El modal se cierra y el scroll salta arriba", "Vuelves haciendo clic para comprobar el cambio"] },
    { "title": "Ahora", "hue": "run", "items": ["Solo se cambia la hoja de estilo", "Lo que escribiste sigue escrito", "El modal sigue abierto y el scroll no se mueve", "El nuevo color simplemente aparece"] }
  ],
  "caption": "Los cambios de hojas de estilo se aplican en su sitio. Los cambios en componentes de React vuelven a renderizar el componente y conservan su estado. Lo que no puede actualizarse de forma segura se recarga, como antes."
}
```

- **Las hojas de estilo se intercambian.** Cambia un archivo `.css`, `.scss` o `.less` y solo esa hoja de estilo se reemplaza en la página en marcha. Nada se recarga.
- **Los componentes de React conservan su estado.** Edita un componente y se vuelve a renderizar con el código nuevo, conservando su estado, gracias al propio Fast Refresh de React. Los contadores mantienen su cuenta y los formularios sus valores.
- **Una salida segura.** Si un cambio no puede aplicarse en su sitio (un cambio en el archivo de entrada de la app, por ejemplo), la página se recarga como siempre, así que nada queda a medio actualizar.

## Hojas de estilo como las escriben los proyectos reales

```bf-figure
{
  "kind": "flow",
  "title": "De tu código a la página",
  "steps": [
    { "label": "styles.scss", "note": "Variables, anidamiento, @use y parciales, o Less con sus mixins", "hue": "make" },
    { "label": "Compilado en el navegador", "note": "Los imports se resuelven desde tu proyecto, luego node_modules y luego la CDN de paquetes", "hue": "run", "tag": "nuevo" },
    { "label": "Button.module.css", "note": "Nombres de clase aislados por archivo, con composes y :global", "hue": "run", "tag": "nuevo" },
    { "label": "Vista previa y sitio publicado", "note": "El mismo CSS en ambos", "hue": "measure" }
  ],
  "caption": "La vista previa y la compilación publicada usan los mismos compiladores, así que lo que ves mientras construyes es lo que se publica."
}
```

- **Sass, SCSS y Less se compilan.** Eso incluye archivos `.scss`, `.sass` y `.less`, y `<style lang="scss">` en componentes de Vue y Svelte. Los parciales, `@use`, `@import` y los imports desde paquetes de npm se resuelven.
- **Los CSS Modules son reales.** `import styles from './Button.module.css'` da a cada clase un nombre aislado, así que `.title` en un componente nunca choca con `.title` en otro. `composes`, `:global` y los keyframes funcionan como esperas.
- **Las hojas de estilo de los paquetes se cargan.** `import 'react-toastify/dist/ReactToastify.css'`, el tema de una librería de componentes o el CSS de un paquete de fuentes ahora se cargan en la vista previa y en el sitio publicado, en lugar de omitirse.

## Next.js en el navegador

Un proyecto de Next.js ahora ejecuta su propio servidor de desarrollo, `next dev`, dentro de la pestaña del navegador, igual que ya lo hacía una app de Express o de Vite. La página que abres la renderiza el propio Next, desde tu directorio `app/`, sin nada nuestro en medio. Los proyectos de SvelteKit funcionan igual: `vite dev` arranca el Vite real y SvelteKit renderiza la página en su propio servidor.

Para lograrlo, el runtime que hay debajo incorporó las partes de Node de las que un framework como Next depende sin decirlo. Los procesos ahora pueden enviarse mensajes (`child_process.fork` y `worker_threads`), los imports dinámicos cargan los archivos del propio proyecto y el compilador WebAssembly de Next se carga donde el nativo no puede. La mayoría de esos cambios también ayudan a otras herramientas.

## Dónde encaja en el método

Construir es el tercer acto de [Read, Prove, Build](/blog/read-prove-build-the-inner-loop). Cómo se vive ese acto depende de una sola cosa: lo corto que es el camino entre *cambiar algo* y *ver qué hizo*.

Las actualizaciones en caliente quitan la recarga de ese camino, y conservar tu sitio quita los clics de vuelta. Las hojas de estilo reales y los frameworks reales arreglan el otro lado: el proyecto que pruebas en la vista previa es el proyecto que vas a publicar, no una copia simplificada que solo se le parece.

## Lo que puedes hacer hoy

- **Cambiar estilos sin perder tu sitio:** abre un modal, edita su CSS y míralo cambiar.
- **Traer tus hojas de estilo tal como están:** parciales de SCSS, Less, CSS Modules y el CSS de tus propios paquetes.
- **Editar un componente de React a mitad de un flujo** y conservar el estado con el que estabas probando.
- **Abrir un proyecto de Next.js o SvelteKit** en un lienzo y ejecutarlo.

---

**Lecturas relacionadas:** [Tu app ahora te responde](/blog/your-app-talks-back) · [Ejecuta la app que tu tablero acaba de construir](/blog/run-your-app-on-the-canvas) · [BuilderForce WebContainers es de código abierto](/blog/builderforce-webcontainers-open-source)

[Abre un lienzo](/create) y cambia algo mientras se ejecuta.
