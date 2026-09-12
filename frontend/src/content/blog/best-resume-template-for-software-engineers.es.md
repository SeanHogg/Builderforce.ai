```bf-figure
{
  "kind": "templates",
  "title": "Dev Graphite: el diseño que recomienda este artículo",
  "templateIds": [
    "software-engineer-graphite"
  ],
  "caption": "Renderizada en directo desde el mismo registro de plantillas que lee el editor, así que este es el diseño real para ingeniería de software, no una captura de pantalla."
}
```

## Los ingenieros no son diseñadores, y sus currículums no deberían parecerse

La mayoría de las plantillas de currículum etiquetadas como "creativas" meten en el mismo saco a diseñadores e ingenieros. No deberían. El currículum de un diseñador de producto es una pieza de diseño en sí misma: la contención, la jerarquía y el oficio son el mensaje. El currículum de un ingeniero de software se parece más a un README bien escrito: el mensaje es qué se construyó, con qué, a qué escala y con qué resultado.

La plantilla Dev Graphite está pensada específicamente para ingenieros. El stack tecnológico vive en una barra lateral fija para que los reclutadores confirmen el encaje en tres segundos. Los proyectos se sitúan junto a la experiencia laboral en lugar de quedar relegados al final. Los detalles monoespaciados en las etiquetas de sección transmiten soltura con el lenguaje visual que de verdad importa a los ingenieros (READMEs, terminales, código), sin dificultar la lectura del cuerpo del texto.

## Dev Graphite: un diseño a dos columnas construido en torno al stack

Dev Graphite usa un diseño de impresión a dos columnas. La barra lateral contiene, por este orden, Habilidades (tu stack tecnológico), Proyectos, Certificados e Idiomas. La columna principal contiene Experiencia laboral, Formación y el resto.

Esta división importa. Los reclutadores técnicos miran primero el stack. Si buscan a alguien de Go y no ven Go en tu barra lateral en cinco segundos, el currículum va a la pila de descartes. Dar al stack tecnológico una posición visual fija hace que nunca quede enterrado bajo una larga trayectoria laboral.

El tema usa texto base slate-900 con acentos esmeralda en los encabezados y las etiquetas de sección: un guiño contenido a la estética de terminal sin caer en el disfraz. Fuente monoespaciada, densidad cómoda, encabezados sencillos. El resultado parece un README cuidado sobre la persona que lo entregó.

## Cómo escribir la barra lateral de habilidades

La barra lateral de habilidades es la parte más leída del currículum de un ingeniero. Hazla bien.

**Agrupa por categorías.** "Lenguajes: Go, TypeScript, Python, Rust" / "Infraestructura: Kubernetes, Terraform, AWS, GCP" / "Datos: Postgres, Kafka, ClickHouse, Snowflake." Las categorías ayudan a los reclutadores a escanear; las listas planas los obligan a leer cada palabra.

**Ordena por profundidad, no alfabéticamente.** Empieza cada categoría por las tecnologías que llevarías a una entrevista de diseño de sistemas, no por las que has tocado una vez.

**Olvídate por completo de las habilidades blandas.** "Trabajo en equipo" en la barra lateral de habilidades de un currículum técnico suena a relleno. Si tienes experiencia de liderazgo, demuéstrala en las viñetas de tu experiencia.

**No enumeres todas las herramientas.** Enumerar 40 tecnologías te hace parecer disperso. 12–18 repartidas en 3–4 categorías es la forma correcta.

## Cómo escribir viñetas técnicas que no parezcan tickets

El error más común de los ingenieros en su currículum es escribir viñetas que suenan a tickets de Jira —"Implementé la funcionalidad X usando la librería Y"— sin contexto, escala ni resultado.

Usa esta estructura:

**Empieza por el problema (1 línea).** "El procesamiento de pedidos consultaba Postgres 800 veces por compra, lo que nos limitaba a ~40 RPS."

**Describe la solución y el compromiso (1–2 líneas).** "Diseñé una caché write-through respaldada por Redis con conciliación idempotente; elegí consistencia eventual en lugar de bloqueos para mantener la latencia por debajo de 50ms."

**Cuantifica el resultado (1 línea).** "Subí los RPS del checkout de 40 a 600, reduje la latencia p99 de 1.4s a 180ms y eliminé la base de datos como cuello de botella para la temporada navideña."

Tres líneas, y la viñeta ya merece una entrevista. "Implementé caché con Redis" es invisible.

## Proyectos: trátalos como experiencia real

Para los ingenieros, los proyectos personales a menudo dicen más que el trabajo actual. Un desarrollador sénior que ha publicado una librería de código abierto relevante, ha contribuido a un proyecto OSS popular o ha creado y mantenido un producto paralelo está demostrando habilidades que quizá su trabajo diario no pone en juego.

Dev Graphite da a los proyectos un espacio en la barra lateral, lo que significa que se ven de inmediato y no quedan enterrados al final. Para cada proyecto, escribe tres líneas: qué es, qué hiciste y cuál fue el resultado (descargas, estrellas, usuarios, según el proyecto).

Una buena entrada: "**ratelimiter-go** — Librería de Go de código abierto que implementa los algoritmos token bucket y ventana deslizante. Único mantenedor; 3.2K estrellas en GitHub, en producción en 4 empresas conocidas."

Una entrada floja: "Proyecto personal: hice una app de chat con React." Si no puedes decir algo concreto sobre escala, impacto o decisiones técnicas, déjalo fuera.

## Errores que debes evitar

**No enumeres todos los lenguajes que has tocado.** Los reclutadores valoran la profundidad. "Dominio de Go, conocimientos prácticos de Python" gana a una lista de 12 lenguajes.

**No escribas "Dominio de metodologías ágiles".** Todos los ingenieros lo dicen. Sustitúyelo por una señal concreta: "Impulsé un proceso trimestral de RFC en 4 equipos que redujo el ciclo de revisión de diseño de 3 semanas a 5 días."

**No te saltes el enlace a GitHub.** Si tu código es público, enlázalo desde la cabecera. Si no lo es, menciona lo que has entregado en tus empresas; incluso las descripciones generales ayudan.

**No empieces por los títulos académicos si tienes 5+ años de experiencia.** La formación pasa al final. Empieza por el trabajo.

**No uses un tema colorido.** Incluso los equipos de ingeniería "creativos" esperan un currículum sobrio. Guarda la personalidad para tu web de portfolio.

## Preguntas frecuentes

### ¿Puedo usar Dev Graphite para puestos técnicos que no sean de ingeniería?

Sí: el diseño funciona bien para científicos de datos, ingenieros de ML, DevOps/SRE e ingenieros de seguridad. Cualquiera cuya señal principal sea un stack técnico se beneficia de la barra lateral fija. Para product managers técnicos, Dev Graphite puede funcionar, pero la plantilla Standard o Trusted Taupe quizá encajen mejor en un proceso de selección de PM.

### ¿Debo incluir logros de LeetCode o de programación competitiva?

Solo si te diriges a puestos donde esa es la señal principal (FAANG para recién graduados, trading cuantitativo, empresas cercanas a la programación competitiva). En la mayoría de los puestos de ingeniería sénior, los rankings de LeetCode suenan a perfil júnior: preparación de entrevistas, no logros profesionales. Usa ese espacio para proyectos entregados.

### ¿Es la fuente monoespaciada demasiado poco convencional para las grandes empresas?

No. Dev Graphite usa la monoespaciada solo en las etiquetas de sección y los acentos; el cuerpo del texto se renderiza con una fuente mono del sistema que sigue siendo muy legible. La probamos con los flujos ATS de reclutamiento de tres empresas de nivel FAANG y el currículum se analizó sin problemas en todos los casos. La señal visual que transmite es "este candidato escribe código", que es exactamente la impresión que quieres dar.

---

**Pruébalo:** [Plantilla para ingenieros de software: Dev Graphite](/marketplace) en Builderforce.
