Renderizas el vídeo de lanzamiento en el tablero. Escribes el anuncio una sola vez. Marcas X, LinkedIn, Instagram, TikTok… y YouTube.

Hasta ahora, YouTube era la casilla que decía que no.

Todas las demás redes aceptan una publicación en una sola petición: algo de texto, quizá un enlace, quizá una imagen que la propia red descarga. YouTube no. Publicar en YouTube significa *enviarle el vídeo*, cada byte, y una película de lanzamiento de tres minutos es mucho más de lo que una petición tiene tiempo de llevar. Así que la respuesta honesta era marcar YouTube como "solo lectura y medición": el tablero podía mostrar las visualizaciones de tu canal, pero la subida en sí era un viaje a YouTube Studio, una descarga, una nueva subida y una descripción copiada y pegada desde otro sitio.

Eso hacía que el activo más importante de un lanzamiento fuera el único que no podía salir con el lanzamiento.

## Una subida que sobrevive a la petición que la inició

La solución no es una petición más larga. Es dejar de tratar la subida como una petición.

```bf-figure
{
  "kind": "flow",
  "title": "Qué ocurre cuando una campaña llega a YouTube",
  "steps": [
    { "label": "Traspaso", "note": "La publicación en YouTube se convierte en un trabajo de subida con su propio registro: qué vídeo, qué canal, cuánto ha confirmado YouTube.", "hue": "reach" },
    { "label": "Enviar un fragmento", "note": "Unos pocos megabytes cada vez, cada uno etiquetado con exactamente el lugar que ocupa en el archivo.", "hue": "reach" },
    { "label": "Preguntar, no suponer", "note": "Antes de enviar más, el trabajo le pregunta a YouTube hasta dónde llegó realmente y continúa desde ahí.", "hue": "measure" },
    { "label": "Aterrizar", "note": "YouTube devuelve el vídeo. La publicación de la campaña se convierte en un enlace.", "hue": "reach", "tag": "en la campaña" }
  ],
  "caption": "Un clip corto termina de una sola vez. Una película larga necesita tantos fragmentos como haga falta. Es el mismo camino en ambos casos, así que el teaser de cinco segundos y la keynote de cuarenta minutos no pueden comportarse de forma distinta."
}
```

Lo que importa es el tercer paso. Un worker en la nube puede detenerse en cualquier momento. Si se detiene a mitad del envío de un fragmento, el trabajo no se fía de su propia idea de cuánto salió. Le pregunta a YouTube, y YouTube dice exactamente cuánto tiene. El siguiente intento empieza desde ese punto. Lo peor que puede costar una conexión caída es un fragmento, nunca el vídeo entero.

Lo mismo ocurre con un mal momento por parte de YouTube. Un error temporal espera y vuelve a intentarlo, un poco más tarde cada vez. Un error que la espera no puede arreglar, como una cuota diaria agotada o una conexión que necesita reconectarse, se detiene de inmediato y dice por qué. No reintenta en bucle.

## Lo que ves

```bf-figure
{
  "kind": "screen",
  "frame": "Una campaña de lanzamiento en el tablero",
  "ratio": 1.62,
  "regions": [
    { "label": "Publicado · X", "note": "Enlaza con la publicación", "x": 4, "y": 10, "w": 44, "h": 16, "hue": "good" },
    { "label": "Publicado · LinkedIn", "x": 52, "y": 10, "w": 44, "h": 16, "hue": "good" },
    { "label": "Publicado · Instagram", "x": 4, "y": 32, "w": 44, "h": 16, "hue": "good" },
    { "label": "Subiendo · 62% · YouTube", "note": "Confirmado por YouTube, no estimado", "x": 52, "y": 32, "w": 44, "h": 16, "hue": "reach" },
    { "label": "Texto · enlace · el vídeo", "x": 4, "y": 56, "w": 92, "h": 36, "hue": "muted" }
  ],
  "caption": "YouTube aparece en la misma lista que todas las demás redes. Su estado pasa de En cola a Subiendo con un porcentaje, luego a Publicado con un enlace, o a Fallido con el motivo."
}
```

El porcentaje es la parte del vídeo que YouTube ha **confirmado**, no la que hemos enviado. Esos dos números pueden diferir, y cuando lo hacen, el confirmado es el verdadero. La campaña también sigue en curso mientras el vídeo todavía se está subiendo. No se da por publicada mientras YouTube solo tiene una parte del archivo.

El mismo cargador está detrás de **Publicar en YouTube** en un vídeo del editor del lienzo. Un render corto sigue terminando antes de que el botón deje de girar. Uno largo ahora muestra cuánto ha llegado, sigue adelante aunque cierres la pestaña y el enlace aparece en el vídeo la próxima vez que alguien lo abra. Antes, los renders largos fallaban solo por ser largos. Eso ya no ocurre.

## Lo que necesita

Dos cosas, ambas de una sola vez:

- **Una cuenta de YouTube en la campaña.** Conéctala junto con las demás cuentas sociales y aparecerá como destino.
- **Una conexión de subida de YouTube.** Conecta YouTube una vez desde un vídeo en el lienzo. Esto permite que las subidas vayan a tu canal. Si la persona que conectó la cuenta de YouTube de la campaña ya lo ha hecho, se usa su canal. Si nadie lo ha hecho, o si dos personas lo han hecho y no está claro de quién es el canal, la publicación lo dice en lugar de adivinar. Un vídeo de lanzamiento en el canal equivocado no se puede retirar discretamente.

El vídeo de la campaña se adjunta igual que un vídeo de Instagram o TikTok. Usa un vídeo del tablero o pega un enlace público. El nombre de la campaña se convierte en el título del vídeo. El texto de la publicación y el enlace de la campaña pasan a ser la descripción.

## Dónde encaja en el método

Todo tablero sigue el mismo arco: **Idea → Crear → Ejecutar → Medir → Alcanzar**. Alcanzar es el último paso, y el que más probablemente ocurre en otro sitio: en una herramienta de programación, en una pestaña de Studio, en una carpeta de exportaciones. Cuando se aleja del tablero, el registro de lo que salió se aleja con él.

```bf-figure
{
  "kind": "compare",
  "title": "Cómo sacar un vídeo de lanzamiento",
  "columns": [
    { "title": "Antes", "hue": "muted", "items": ["Renderizar en el tablero", "Descargar el archivo", "Abrir YouTube Studio", "Subirlo de nuevo", "Pegar la descripción", "Publicar el enlace de vuelta a mano", "Nada en el tablero sabe que salió"] },
    { "title": "Ahora", "hue": "reach", "items": ["Renderizar en el tablero", "Marcar YouTube en la campaña", "Verlo subir junto a las demás redes", "El enlace aterriza en la campaña"] }
  ],
  "caption": "El vídeo sale con la campaña a la que pertenece, así que su resultado queda junto a X, LinkedIn e Instagram. Puedes ver qué publicaciones están activas, y dónde, sin preguntar."
}
```

Medir y Alcanzar comparten un bucle. Las visualizaciones del canal ya estaban en el tablero, a través del mosaico del feed de YouTube. Ahora el vídeo que consigue esas visualizaciones también sale desde el tablero, así que el siguiente paso, ver cómo le va, empieza en el mismo lugar donde empezó el lanzamiento.

---

**Lecturas relacionadas:** [Crea escenas de vídeo y películas en el lienzo](/blog/make-video-scenes-and-movies-on-the-canvas) · [Ejecuta la aplicación que tu tablero acaba de construir](/blog/run-your-app-on-the-canvas)

[Abre un lienzo](/create), renderiza el vídeo y envíalo junto con el resto del lanzamiento.
