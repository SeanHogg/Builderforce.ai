Abre casi cualquier plataforma empresarial y el menú de la izquierda es un organigrama. Ventas. Marketing. Finanzas. Ingeniería. RR. HH. Es una lista perfectamente razonable, y responde a una pregunta que solo puede hacerse una empresa que ya existe: *¿de qué departamento es esto?*

Quien llega con una idea no puede responder a esa pregunta. No tiene departamentos. Tiene algo que quiere crear y ni idea de qué viene después.

Por eso Builderforce agrupa sus destinos según **en qué punto del recorrido estás**.

```bf-figure
{
  "kind": "stack",
  "title": "Cada destino está exactamente en uno de estos",
  "bands": [
    { "label": "Idea", "note": "¿Y si…? — Lienzo. Una sola fila, porque en esta etapa solo hay una cosa que hacer.", "hue": "idea", "tag": "público" },
    { "label": "Crear", "note": "Constrúyelo. — Proyectos, Plantilla, Calidad, Fiabilidad, Conocimiento, Integrado.", "hue": "make" },
    { "label": "Operar", "note": "Llévalo como una empresa. — Finanzas, Ingresos, Personas, Contratación, Inversores, Gobernanza, Soporte, Crecimiento, Bandeja de entrada.", "hue": "run" },
    { "label": "Medir", "note": "¿Está funcionando? — Análisis: entrega, autonomía, finanzas, DevEx, cumplimiento, alertas.", "hue": "measure" },
    { "label": "Alcance", "note": "Véndelo, haz que te encuentren, hazlo crecer. — el Mercado como segunda puerta de entrada, y el programa de ventas propio de cada cuenta.", "hue": "reach", "tag": "público" }
  ],
  "caption": "Administración es la sexta y es deliberadamente aburrida. Nadie curiosea los ajustes de un producto antes de registrarse. Alcance eran antes dos bandas —Mercado y Expansión— hasta que la segunda resultó tener una sola fila; un encabezado con una sola cosa debajo es una etiqueta, no una arquitectura."
}
```

El orden es el argumento. Léelo de arriba abajo y es una frase sobre cómo llega a existir un negocio.

## Qué sustituyó esto, y por qué no era solo desorden

Merece la pena concretar, porque «hemos reorganizado la navegación» es la frase menos interesante del software, y esto no fue eso.

Había **cuatro** listas distintas que declaraban destinos navegables. Una para la barra lateral con la sesión iniciada. Otra para las páginas de marketing. Otra para los dominios del modelo de datos. Otra para el pie de página. El CFO existía cuatro veces, con cuatro nombres, y una de esas cuatro sacaba a un cliente con la sesión iniciada *fuera del producto* para llevarlo a una página de marketing que describía lo que ya estaba usando.

Eso no es un problema estético. Es una persona que pierde su sesión para leer un folleto sobre su propio espacio de trabajo.

```bf-figure
{
  "kind": "compare",
  "title": "Cuatro listas, o una",
  "columns": [
    {
      "title": "Cuatro registros",
      "hue": "bad",
      "items": [
        "La barra lateral decía \"Finanzas\"; el menú decía \"Inteligencia de negocio\".",
        "Destinos enteros no tenían ninguna fila de marketing, así que el menú anunciaba un producto más pequeño que el que existía.",
        "El pie de página listaba un id que nada declaraba y mostraba en silencio una columna incompleta.",
        "Cada corrección había que hacerla en cuatro sitios, y el cuarto siempre se descubría más tarde."
      ]
    },
    {
      "title": "Un registro, proyectado",
      "hue": "good",
      "items": [
        "La barra lateral, los menús, el pie de página y /features leen el mismo array.",
        "Una capacidad que el producto no tiene no puede aparecer en el sitio de marketing.",
        "La pregunta de cada etapa tiene un único hogar y se muestra igual en todos los sitios donde aparece.",
        "Un script de build falla si aparece una segunda lista. La regla se hace cumplir, no se recuerda."
      ]
    }
  ]
}
```

La última línea es la que hace que funcione. Hay una comprobación en la batería de tests que recorre todos los archivos fuente buscando un objeto que tenga a la vez un campo con aspecto de ruta y un campo con aspecto de etiqueta —un destino, lo llames como lo llames— y hace fallar el build si encuentra alguno fuera del registro. Existen excepciones, y cada una tiene que llevar una frase escrita que explique por qué una fila del registro no podía cubrir ese caso.

Un *recuento* dejaría la deuda ahí, aparentando progreso. Una *lista de motivos* obliga al siguiente autor a explicar en voz alta por qué su excepción lo es.

## El sitio de marketing es una proyección

Esta es la parte que más importa a quien lee el sitio en lugar de usar el producto: **`/features` se genera a partir de ese mismo registro.**

La tabla de etapas, las etiquetas de destino, los recuentos de la tarjeta de resumen: todo se calcula. Lo que significa que la página no puede anunciar un destino que no existe ni olvidar uno que sí existe. Una cifra de marketing que se desvía del producto es la mentira más barata de publicar y, con diferencia, la más cara de detectar.

```bf-figure
{
  "kind": "flow",
  "title": "Una declaración, cuatro consumidores",
  "steps": [
    { "label": "El registro", "note": "Un solo array. Cada fila lleva su responsable (qué puesto), su etapa (en qué punto del arco) y el nivel en que se activa.", "hue": "make" },
    { "label": "El panel izquierdo", "note": "Agrupa por etapa. Las filas por encima de tu nivel aparecen atenuadas, nunca ocultas: una fila atenuada es una invitación; una fila ausente, un secreto.", "hue": "run" },
    { "label": "Los menús públicos", "note": "Producto ▾ muestra Idea · Crear · Operar · Medir. Aprender ▾ muestra Leer · Demostrar · Construir con.", "hue": "read" },
    { "label": "/features", "note": "Las mismas filas otra vez en forma de tabla, con la pregunta que responde cada etapa y un enlace por destino.", "hue": "measure" }
  ],
  "caption": "Las tres columnas del menú Aprender son los tres actos del propio método con otro sombrero: leer, demostrar, construir con. Esa rima no es decoración; es la misma actitud aplicada a aprender sobre el producto en lugar de crear algo con él."
}
```

## Revelación progresiva, y por qué no se oculta nada

Una fila **siempre aparece en la lista**. Lo que el recorrido controla es su *estado*, no su existencia.

Quien no tiene cuenta lo ve todo: el CFO, el reclutador, la superficie de gobernanza, el equipo completo, atenuado, con una línea honesta y un único botón de configuración que lleva a quien sea responsable de lo que necesitarías primero. El botón del CFO te lleva al CEO, porque el CEO es responsable de constituir la empresa y el CFO no puede existir antes de que exista una empresa.

El razonamiento cabe en una frase: **nadie pide una capacidad que nunca ha visto.** Ocultar las superficies de negocio hasta que alguien «cumpla los requisitos» convierte una rampa en una puerta cerrada, y quien se queda al otro lado nunca sabe qué había detrás.

Y no hace falta subir hasta el final. Detenerse a mitad de camino es un uso completo y exitoso del producto. Quien publica tres landing pages y nunca constituye una empresa no ha fracasado en el onboarding: ha conseguido lo que venía a buscar.

## Lo único que una etapa no puede ser

Una etapa no es un departamento, y la tentación de convertirla en uno es constante. La prueba más clara que aplica el equipo: **¿esto es una fase del trabajo o un grupo de personas?**

«IA» no superó esa prueba, y por eso no hay una sección de IA. Sus destinos fueron a los puestos responsables del trabajo: la categorización de gastos a Finanzas, el análisis de contratos a Gobernanza, la vigilancia de la competencia a Crecimiento, los comentarios sobre el pitch deck al CEO. Un elemento de menú con el nombre de una tecnología te dice de qué está hecho el software. Los puestos te dicen para qué sirve.

La misma prueba, la misma respuesta, para «Informes», «Automatización» e «Integraciones». Cada una es una propiedad de muchos destinos, no un lugar.

---

*Mira todo el arco generado en directo en [la página de funciones](/features), o sáltate el recorrido y [empieza por Idea](/create/new). El método que llevan las etapas está explicado en [De la idea a lo real](/blog/idea-to-real-the-operating-methodology).*
