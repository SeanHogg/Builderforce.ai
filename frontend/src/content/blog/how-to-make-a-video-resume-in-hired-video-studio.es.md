## Por qué Studio supera grabar con el móvil

Puedes grabar un vídeo currículum con el móvil, pero lucharás contra tres cosas: ceñirte al guion, arreglar la única escena en la que tropezaste y conseguir un audio limpio. El Creation Canvas de Builderforce resuelve las tres en el navegador: un teleprompter que desplaza tu guion, repeticiones escena por escena para que una mala toma no te cueste todo el vídeo y nivelación de audio al exportar.

Todo el ciclo (guion, grabación, edición, renderizado y publicación) ocurre en una sola pestaña. El renderizado se ejecuta en el cliente con ffmpeg.wasm, así que no hay que subir y esperar.

## Paso 1: Escribe el guion por escenas

Abre [Studio](/creation-canvas), crea un documento de vídeo y escribe tu guion dividido en escenas. La estructura probada de 60 segundos es: gancho (una afirmación específica), nombre y rol, una historia (problema, acción, resultado) y un cierre que nombre el puesto que quieres.

Mantén cada escena en una sola idea. Las escenas son la unidad que volverás a grabar, así que un corte de escena ajustado significa una repetición limpia. Apunta a 60–90 segundos en total: 130–180 palabras habladas.

## Paso 2: Graba con el teleprompter

Activa el teleprompter y desplazará tu guion sobre la vista previa de la cámara mientras grabas, así mantienes el contacto visual en lugar de leer mirando de lado. Graba escena por escena. Si te trabas en la escena 3, vuelve a grabar solo la escena 3: el resto no se toca.

Mira al objetivo, no a tu propia imagen. Siéntate un paso más formal que el día a día de la empresa. Graba cada escena varias veces y quédate con la toma que suene conversacional, no memorizada.

## Paso 3: Pule: locución, recortes, música

Si prefieres no salir en cámara en parte del vídeo, genera una locución con IA a partir de tu guion para esas escenas. Recorta los silencios al principio y al final de cada escena. Añade un fondo musical suave si encaja con tu tono, ajusta su nivel por debajo de tu voz y la exportación se encarga de nivelar.

No edites en exceso. Un vídeo currículum que se corta visiblemente cada dos segundos transmite ansiedad. Dos o tres transiciones de escena limpias valen más que una docena de cortes bruscos.

## Paso 4: Renderiza y publica

La exportación renderiza el MP4 final en tu navegador. Publícalo en tu perfil como tu vídeo currículum, adjúntalo a tus candidaturas o toma el enlace público `/v/<id>` para compartirlo donde quieras.

Actualízalo cuando tu métrica principal se quede anticuada o cambie tu rol; para la mayoría de la gente es una vez cada 12–18 meses. Volver a grabar una escena es barato, así que mantenerlo al día es fácil.

## Preguntas frecuentes

### ¿Cuánto debería durar un vídeo currículum?

De 60 a 90 segundos. Los vídeos más largos no se ven hasta el final; los más cortos no tienen espacio para una historia. Pon tu afirmación más fuerte y específica en los tres primeros segundos para que el reclutador decida seguir viendo.

### ¿Puedo volver a grabar solo una parte?

Sí. Studio graba escena por escena, así que puedes volver a grabar una sola escena sin rehacer todo el vídeo. Es la mayor ventaja frente a grabar una toma continua con el móvil.

### ¿Tengo que subir mi material para renderizar?

No. Studio renderiza el vídeo final en el cliente con ffmpeg.wasm, así que tu material en bruto no necesita subirse a un servidor para producir el MP4 terminado.

---

**Pruébalo:** [Studio](/creation-canvas) en Builderforce.
