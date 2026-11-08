## Para qué sirve el tipo de medio Podcast

El Creation Canvas de Builderforce ya no es solo de vídeo. El documento de Studio incluye un `mediaKind` (vídeo, podcast, voz o animación), y el tipo podcast cambia el editor a un diseño centrado en el audio: pistas de forma de onda en lugar de un lienzo visual, marcadores de capítulo en lugar de escenas y una exportación que produce un MP3 limpio en lugar de un MP4.

Un episodio de podcast es el formato adecuado cuando tu mensaje se entiende mejor escuchándolo que viéndolo: un episodio con tu historia profesional para tu perfil, una explicación de tu especialidad que demuestre pericia o una entrevista que presentas como Creator. Como el mismo modelo de documento respalda todos los tipos de medio, puedes empezar con un guion de vídeo y convertirlo en podcast sin volver a teclear una palabra.

## Paso 1: Abre Studio y elige el tipo Podcast

Abre [Studio](/creation-canvas) y crea un documento nuevo. En el selector de documento nuevo, elige **Podcast**. El editor carga el diseño de audio: una barra de transporte, una o más pistas de audio y un panel de guion a la izquierda.

Si ya tienes un borrador de vídeo que prefieres narrar como audio, ábrelo y cambia su tipo de medio desde los ajustes del documento: el guion y la estructura de capítulos se conservan, y las capas visuales simplemente se ocultan en la exportación de audio.

## Paso 2: Escribe o pega tu guion

Escribe tu episodio en el panel de guion, dividido en capítulos. Cada capítulo se convierte en un marcador en la línea de tiempo para que los oyentes (y tú, mientras editas) puedan saltar entre segmentos.

Mantén los capítulos cortos: de 60 a 120 segundos de audio hablado cada uno. Un episodio de 10 minutos son aproximadamente 1.300–1.500 palabras habladas. El teleprompter lee de este panel mientras grabas, así que escribe como hablas: frases cortas, una idea por línea.

## Paso 3: Graba o genera una locución con IA

Tienes dos formas de llevar audio a la pista:

**Grábate a ti mismo.** Haz clic en grabar, lee del teleprompter y Studio captura una pista en el navegador. Vuelve a grabar cualquier capítulo por separado sin tocar el resto: los marcadores de capítulo hacen que el cambio sea limpio.

**Genera una locución con IA.** Si te da reparo grabar tu voz o quieres un narrador constante, selecciona un capítulo y genera texto a voz a partir del guion. Es el mismo motor TTS que se usa para la locución de vídeo; trabaja sobre el texto de tu guion, así que las actualizaciones se mantienen sincronizadas.

La mayoría de los creadores combinan ambas: locución con IA para introducciones, cierres y segmentos publicitarios; su propia voz para las partes que necesitan autenticidad.

## Paso 4: Edita, añade una segunda pista y exporta

Recorta silencios y tropiezos directamente sobre la forma de onda. Añade una segunda pista para música de entrada o un fondo bajo tu narración, y ajusta su nivel para que quede detrás de tu voz. Studio renderiza la mezcla en el navegador con el mismo pipeline de ffmpeg.wasm que la exportación de vídeo: sin viaje al servidor y sin subir tu audio en bruto.

Cuando estés conforme, exporta a MP3. Publícalo en tu perfil como currículum en audio, adjúntalo a una publicación de Creator o descárgalo para un alojamiento de podcast externo. Todo el ciclo, del guion al episodio publicado, ocurre en una sola pestaña.

## Preguntas frecuentes

### ¿Necesito descargar algún software para grabar un podcast?

No. Studio graba, edita y exporta por completo en el navegador. La grabación usa el micrófono de tu dispositivo a través del navegador y la mezcla final se renderiza en el cliente con ffmpeg.wasm, así que tu audio en bruto no tiene que subirse para renderizar un episodio.

### ¿Puedo convertir un borrador de vídeo existente en un podcast?

Sí. Como todos los documentos de Studio comparten un único modelo subyacente con un eje mediaKind, puedes cambiar un documento de vídeo al tipo podcast. El guion y la estructura de capítulos se conservan; las capas visuales simplemente se excluyen de la exportación solo de audio.

### ¿Es obligatoria la locución con IA?

No, es opcional. Puedes grabar por completo con tu propia voz, generar cada capítulo con locución de IA o combinar ambas. El teleprompter funciona en cualquier caso para que sigas el guion mientras grabas.

---

**Pruébalo:** [Studio](/creation-canvas) en Builderforce.
