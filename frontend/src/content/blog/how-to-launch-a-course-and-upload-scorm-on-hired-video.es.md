## Quién puede crear un curso

La creación de cursos en Builderforce está abierta a Creators y empleadores: la misma comprobación de elegibilidad (`resolveAuthorEligibility`) controla tanto la creación de cursos como la de aulas. Los estudiantes son candidatos en modo aprendizaje; no necesitas una cuenta de "instructor" aparte para publicar.

Un curso es la superficie adecuada cuando tienes material estructurado y a ritmo propio: un currículo de incorporación, un itinerario de preparación para una certificación o un curso de habilidades que vendes. Si prefieres impartir una clase en directo, por cohortes y con tareas, consulta la guía de aulas: comparten infraestructura pero resuelven trabajos distintos.

## Paso 1: Crea el curso y añade módulos

Desde el panel de Creator abre [Cursos](/training) y crea un curso nuevo. Dale un título, una descripción y la audiencia a la que va dirigido. Después añade módulos: cada módulo es una unidad del currículo, y los módulos contienen lecciones.

Estructura el recorrido antes de llenarlo. Un estudiante debería poder leer tu lista de módulos y entender el arco: fundamentos, luego aplicación, luego evaluación. El orden importa porque las rutas de aprendizaje admiten prerrequisitos: los módulos posteriores pueden exigir los anteriores.

## Paso 2: Sube un paquete SCORM 1.2

Si has creado contenido en una herramienta como Articulate Storyline, iSpring o Adobe Captivate, expórtalo como paquete SCORM 1.2 (un .zip) y súbelo como lección. Builderforce incluye un runtime SCORM 1.2 integrado, así que las llamadas de finalización, puntuación y marcador del paquete se capturan de forma nativa, sin necesidad de un LMS de terceros.

SCORM es la elección adecuada cuando tu contenido es interactivo (escenarios ramificados, cuestionarios incrustados, arrastrar y soltar). Para lecciones sencillas de vídeo o texto no necesitas SCORM en absoluto: créalas directamente como lecciones.

## Paso 3: Sigue la finalización con el LRS xAPI

Además de SCORM, Builderforce incluye un Learning Record Store xAPI. Las declaraciones ("el estudiante X completó la actividad Y") se registran en el LRS, lo que te da un registro duradero y consultable de quién hizo qué, a través de paquetes SCORM, lecciones nativas y nodos de rutas de aprendizaje.

Esto es lo que hace que completar signifique algo. Cuando un estudiante termina el recorrido requerido, el LRS tiene la evidencia, que es la base para emitir un certificado en el que un tercero pueda confiar de verdad.

## Paso 4: Emite un certificado verificable

Al completar, Builderforce puede emitir un certificado firmado con un HMAC para que su autenticidad pueda verificarse más tarde. El titular comparte el certificado; un verificador comprueba la firma y confirma que se emitió realmente para ese estudiante y ese curso: no se puede falsificar editando un PDF.

Los certificados también se integran con la gamificación: completar aprendizaje otorga puntos y puede desbloquear insignias, lo que mantiene a los estudiantes avanzando por el recorrido. Publica el curso, fija su precio (o hazlo gratuito) y los estudiantes se inscriben, progresan y obtienen una credencial que resiste el escrutinio.

## Preguntas frecuentes

### ¿Necesito un LMS externo para alojar SCORM?

No. Builderforce tiene un runtime SCORM 1.2 integrado, así que subes tu .zip SCORM como lección y la plataforma captura directamente la finalización, la puntuación y el marcador. También hay un LRS xAPI para el seguimiento a nivel de declaración en todos los tipos de lección.

### ¿Los certificados son realmente verificables?

Sí. Los certificados se firman con un HMAC, de modo que un verificador puede confirmar que el certificado se emitió realmente para un estudiante y un curso concretos. Eso lo hace evidente ante manipulaciones: a diferencia de un PDF normal, no se puede falsificar editando el texto.

### ¿Los empleadores también pueden crear cursos, o solo los Creators?

Ambos. La creación de cursos y aulas comparte una única comprobación de elegibilidad, así que tanto Creators como empleadores pueden publicar. Esto permite que una empresa monte un currículo de incorporación o de cumplimiento normativo en la misma superficie que un Creator usa para vender un curso de habilidades.

---

**Pruébalo:** [Cursos](/training) en Builderforce.
