Describes una app pequeña: una página de lista de espera que guarda los registros y te envía un correo cuando alguien se apunta. Treinta segundos después hay una docena de archivos, un servidor y un formulario.

Lo que pasa a continuación es lo que importa, y hasta ahora salía mal de una de tres maneras. El proyecto necesitaba un servidor y la vista previa no podía ejecutarlo. El siguiente turno del agente rompía algo que funcionaba un minuto antes y no había una forma limpia de volver atrás. O todo funcionaba y no tenías ni idea de adónde iban los registros.

**Builderforce Studio** está construido en torno a esos tres momentos.

## Una ventana, del prompt a la app en ejecución

Abre [studio.builderforce.ai](https://studio.builderforce.ai), escribe lo que quieres y estarás en un espacio de trabajo con el agente a un lado y la app en ejecución al otro. No necesitas una cuenta para empezar a escribir. El inicio de sesión ocurre en una ventana emergente cuando hace falta, así que el prompt que escribiste sigue ahí cuando vuelves.

```bf-figure
{
  "kind": "screen",
  "frame": "Un proyecto de Studio",
  "ratio": 1.62,
  "regions": [
    { "label": "Agente", "note": "Describe el cambio; cada turno se convierte en una versión", "x": 3, "y": 10, "w": 24, "h": 80, "hue": "idea" },
    { "label": "Vista previa · Código · Base de datos", "note": "La app en ejecución, su código fuente y lo que almacena", "x": 29, "y": 10, "w": 46, "h": 62, "hue": "make" },
    { "label": "Terminal · Salida · Problemas", "x": 29, "y": 75, "w": 46, "h": 15, "hue": "run" },
    { "label": "Archivos · Versiones · Publicar", "x": 77, "y": 10, "w": 20, "h": 80, "hue": "accent" },
    { "label": "Publicar · GitHub · Compartir", "x": 60, "y": 2, "w": 37, "h": 6, "hue": "accent" }
  ],
  "caption": "Todo lo que necesita una app pequeña, en una sola ventana: la conversación, el resultado en ejecución, sus archivos e historial, y sus datos."
}
```

## Funciona, sea cual sea el tipo de app

Las vistas previas antes cubrían páginas, no servidores. Si el agente escribía una API de Express, una app de Vue o una app de Svelte, la vista previa no tenía nada que mostrar.

Ahora todo se ejecuta en tu navegador sobre el runtime propio de Builderforce. Se instalan las dependencias del proyecto, arranca su servidor y la vista previa muestra sus rutas reales. Los proyectos de Vue y Svelte se previsualizan y se publican igual que los de React. La terminal es un shell real: `npm install`, `node server.js`, `ls`, `cat`.

```bf-figure
{
  "kind": "flow",
  "title": "Qué pasa cuando pulsas Ejecutar",
  "steps": [
    { "label": "Vista previa instantánea", "note": "Un proyecto Vite, React, Vue, Svelte o estático se sirve directamente desde memoria, sin paso de instalación.", "hue": "make" },
    { "label": "O su propio servidor", "note": "Un proyecto con servidor Node ejecuta npm install y npm run dev, y la vista previa sigue el puerto que abre.", "hue": "make" },
    { "label": "Las ediciones llegan en vivo", "note": "Cada cambio, tuyo o del agente, recarga la vista previa.", "hue": "run", "tag": "en el navegador" }
  ],
  "caption": "Sin sesión medida, sin máquina en la nube que esperar. El código se ejecuta en un dominio de vista previa aparte, así que nunca comparte tu inicio de sesión de Builderforce."
}
```

Publicar también compila el sitio en el navegador, con recursos con hash y una base relativa, listo para servirse en tu subdominio. Comprobar verifica los tipos del proyecto y lo compila. Todo lo que falla va al agente junto con el error, de modo que una compilación rota se arregla en lugar de quedarse ahí pareciendo terminada.

## Cada turno es una versión

Cuando el agente termina un turno, los archivos que tocó se convierten en una versión: *Cambió App.tsx, Header.tsx y 2 más*. Puedes ponerle nombre a una tú mismo antes de probar algo arriesgado. Restaurar lleva dos clics y antes guarda el punto en el que estás, así que una restauración es en sí misma algo que puedes deshacer.

```bf-figure
{
  "kind": "compare",
  "title": "Cuando el siguiente turno rompe lo que funcionaba",
  "columns": [
    { "title": "Antes", "hue": "muted", "items": ["Pedirle al agente que lo deshaga", "Esperar que recuerde qué era 'eso'", "Comparar archivos a ojo", "Perder el cambio bueno junto con el malo"] },
    { "title": "En Studio", "hue": "make", "items": ["Abrir Versiones", "Elegir el turno anterior al fallo", "Restaurar — y el estado actual se guarda antes", "Seguir desde ahí"] }
  ],
  "caption": "Las versiones se registran mientras el agente trabaja, sin que tengas que acordarte de guardar."
}
```

## Los datos de la app tienen un lugar donde vivir

Una app publicada conserva lo que la gente le envía. La vista **Base de datos** está junto a Vista previa y Código:

- **Tablas.** Cada colección en la que escribe la app, con sus filas, su endpoint y sus interruptores: abrir un ticket por cada envío, dejar que los usuarios con sesión iniciada lean sus propias filas. Añade una tabla, elimina una fila o elimina una tabla.
- **Usuarios.** Todas las personas que iniciaron sesión en tu app. Entran con un código de un solo uso por correo, así que no hay contraseñas que gestionar. Suspende a alguien, lo que cierra su sesión en todas partes, o elimínalo.
- **Funciones de servidor.** Los manejadores del backend de la app y los secretos que usan. Funcionan antes de publicar.

Antes de la primera publicación, la vista te lo indica y abre Publicar. Después, todo se rellena solo.

## Dónde encaja en el método

El trabajo en Builderforce sigue un arco — **Idea → Make → Run → Measure** — y cada acto pasa por el mismo bucle interno: [Read, Prove, Build](/blog/read-prove-build-the-inner-loop).

Studio es el acto **Make** hecho corto. Una idea se convierte en una app en ejecución en la misma ventana en la que la describiste, y **Build** deja de ser el paso donde se escapa la atención: sin terminal en otro sitio, sin despliegue que esperar, sin una segunda pestaña.

Las versiones mantienen honesto a **Build**. Cuando el agente prueba algo, ves el resultado en la vista previa, y si está mal vuelves un turno atrás. Probar cosas no cuesta nada, que es como debería sentirse un bucle.

La vista Base de datos es donde empieza **Run**. En cuanto la app está activa, las personas que la usan y lo que envían están en la misma pantalla que el código que las sirve. Esa es también la primera evidencia con la que tiene que trabajar **Measure**: quién se registró y qué pidió.

## Qué puedes hacer con ello hoy

- **Pasar de un prompt a una app en ejecución**, servidor incluido, sin instalar nada.
- **Deshacer cualquier turno del agente** con dos clics, y poner nombre a las versiones que importan.
- **Ver y gestionar los datos y usuarios de tu app** junto a su código.
- **Publicar** en tu propio subdominio, o enviar a GitHub, desde la cabecera.

Los servidores de desarrollo de Next.js, Nuxt y SvelteKit todavía no se ejecutan en el navegador; para esos, Ejecutar te dice por qué en lugar de fallar en silencio.
