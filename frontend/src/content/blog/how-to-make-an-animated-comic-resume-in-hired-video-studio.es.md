## Cuándo un cómic supera a un busto parlante

Para la mayoría de los roles, un vídeo currículum de 60 segundos con una persona hablando a cámara es el activo de mayor impacto que puedes crear. Pero para roles de diseño, ilustración, motion, marketing y marca, un responsable de contratación quiere *ver* tu estética, no solo oírte describirla. Un currículum en cómic animado es el formato que pone tu oficio sobre la página.

El tipo de medio animación de Studio te da un lienzo por capas con una línea de tiempo de fotogramas clave. Construyes viñetas, colocas capas (fondo, personaje, bocadillos de texto) y animas propiedades (posición, escala, opacidad) a lo largo del tiempo. El resultado es un vídeo corto renderizado que puedes publicar en tu perfil o adjuntar a una candidatura.

## Paso 1: Inicia un documento de animación

Abre [Studio](/creation-canvas), crea un documento nuevo y elige el tipo **Animación**. El editor carga un lienzo y una línea de tiempo de fotogramas clave. Define primero la relación de aspecto: el cuadrado (1:1) se ve bien en un feed y el 16:9 se reproduce limpio como vídeo incrustado.

Piensa en viñetas como lo haría un cómic: de 4 a 8 viñetas, cada una un momento de tu historia. Esboza los momentos antes de construir ("introducción", "el proyecto", "el resultado", "la petición") para animar siguiendo un guion en lugar de improvisar.

## Paso 2: Construye capas y bocadillos

Cada viñeta es una pila de capas. Añade un fondo, un personaje o ilustración y capas de texto para pies de viñeta y bocadillos. El modelo de capas de Studio es el mismo que usa el lienzo de vídeo, así que todo lo que puedas colocar en una escena de vídeo (formas, imágenes, texto, fuentes) funciona también aquí.

Mantén el texto corto. Un bocadillo que tarda más de dos segundos en leerse rompe el ritmo. Deja que lo visual cuente la historia y usa los pies de viñeta para fijar los datos clave (tu nombre, la métrica, el puesto que quieres).

## Paso 3: Anima con fotogramas clave

Selecciona una capa, mueve el cabezal y define fotogramas clave en las propiedades que quieras animar. Desliza un personaje desde fuera del lienzo, haz aparecer un pie de viñeta con un fundido o haz saltar un bocadillo con un escalado rápido. Studio interpola entre fotogramas clave, así que dos fotogramas clave por propiedad suelen bastar para un movimiento limpio.

Prefiere unos pocos movimientos seguros a un movimiento constante. Los currículums en cómic más eficaces mantienen cada viñeta el tiempo suficiente para leerla y luego hacen la transición con una animación deliberada en lugar de animarlo todo a la vez.

## Paso 4: Renderiza en el navegador y publica

La exportación renderiza la animación a vídeo en el cliente con el mismo pipeline de ffmpeg.wasm que cualquier otro tipo de medio de Studio: sin subida y sin cola de servidor. Añade antes una pista de audio si quieres narración o un fondo musical; la locución con IA funciona aquí exactamente igual que en vídeo.

Publica el clip renderizado en tu perfil, adjúntalo a una candidatura creativa o publícalo como Creator. Para roles de diseño y motion, un currículum en cómic suele ser el único activo que hace que te recuerden entre una pila de PDFs.

## Preguntas frecuentes

### ¿Necesito ser ilustrador para hacer un currículum en cómic?

No. Puedes construir viñetas con formas, texto e imágenes importadas. Una buena ilustración ayuda en roles de ilustración en concreto, pero el formato funciona con gráficos simples por capas: la estructura narrativa importa más que el dibujo.

### ¿Cuál es la diferencia entre el tipo animación y un vídeo?

Ambos se exportan a vídeo, pero el tipo animación se basa en una línea de tiempo de fotogramas clave y un lienzo por capas para movimiento sintético, mientras que el tipo vídeo se basa en escenas grabadas y un teleprompter. Usa animación cuando creas movimiento a partir de capas; usa vídeo cuando te grabas a ti mismo.

### ¿Dónde se hace el renderizado?

En tu navegador. Studio usa ffmpeg.wasm para renderizar el vídeo final en el cliente, así que tus recursos no tienen que subirse a una granja de renderizado y no hay coste de infraestructura por renderizado.

---

**Pruébalo:** [Studio](/creation-canvas) en Builderforce.
