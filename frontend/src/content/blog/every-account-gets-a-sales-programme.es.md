Puedes llevar una idea a un lienzo, discutirla hasta convertirla en objetos, construir la cosa, operarla como una empresa y comprobar si funcionó. Después, alguien tiene que comprarla.

Hasta esta semana, la barra lateral izquierda tenía una respuesta honesta a eso para exactamente un tipo de cuenta. El **Centro de ventas** —pipeline, campañas, objetivos semanales, informes, pagos, el kit de ventas— era una fila que solo veías si te habías registrado como asociado de ventas de Builderforce. Todos los demás, incluido cada fundador que acababa de lanzar algo en la plataforma, tenían una barra que decía *Idea · Crear · Operar · Medir* y luego les entregaba una publicación en el mercado y les deseaba suerte.

Eso no es una función que falta. Es una función construida detrás de la puerta equivocada.

## Qué lo bloqueaba en realidad

Una línea. El servicio que responde *de quién es este espacio de ventas* pedía un tipo de cuenta antes de entregarle a una persona el suyo propio:

```
if (requested === current.id) return current.accountType === 'sales' ? { … } : null;
```

Cada fila que toca el hub —contactos, campañas, objetivos, referidos, reglas de comisión— ya está indexada por `ownerUserId`. Nunca se compartió nada entre cuentas. La comprobación no protegía los datos de nadie; decidía quién tenía derecho a un pipeline propio. Así que abrirlo fue retirar una barrera, no ampliar un alcance, y la lectura entre cuentas siguió siendo exactamente igual de estrecha: un superadministrador solo puede abrir el espacio de un asociado de la plataforma, nunca el pipeline privado de un cliente.

```bf-figure
{
  "kind": "compare",
  "title": "El mismo hub, dos poblaciones",
  "columns": [
    { "title": "Antes", "hue": "muted", "items": [
      "Asociados de ventas que venden el propio Builderforce",
      "Un superadministrador que lee las cifras de un asociado",
      "Todos los demás: sin fila, sin pipeline, sin enlace de referido"
    ] },
    { "title": "Ahora", "hue": "reach", "items": [
      "Cada cuenta, en su propio espacio de trabajo",
      "Un superadministrador que lee las cifras de un asociado, sin cambios",
      "Un hub, una definición de tasa de conversión, un informe"
    ] }
  ],
  "caption": "Un segundo hub para fundadores habría sido una segunda definición de «ganado» esperando a contradecir a la primera."
}
```

## Qué obtienes la primera vez que lo abres

Seis subvistas, todas ya plenamente operativas porque los asociados llevan tiempo gestionando el negocio con ellas:

```bf-figure
{
  "kind": "stack",
  "title": "Sales Hub",
  "bands": [
    { "label": "Resumen", "note": "Objetivos semanales frente a lo que ocurrió de verdad: prospección, contactos, reuniones.", "hue": "reach" },
    { "label": "Leads", "note": "El pipeline. Siete etapas, un valor del trato, una probabilidad, una fecha prevista de cierre.", "hue": "reach" },
    { "label": "Informes", "note": "Registros, conversiones, ingresos convertidos, comisión ganada: un solo informe, lo lea quien lo lea.", "hue": "measure" },
    { "label": "Pagos", "note": "Lo ganado sale del dominio de ventas, lo pagado del libro contable, y lo disponible es la resta entre ambos.", "hue": "run" },
    { "label": "Bandeja", "note": "El buzón conectado, junto al pipeline en el que está trabajando.", "hue": "reach" },
    { "label": "Kit de ventas", "note": "El material comercial y el enlace de referido que te atribuye un registro.", "hue": "reach" }
  ],
  "caption": "Aquí no hay código nuevo. Es el mismo hub que movía el programa de asociados de Builderforce, ahora en manos de la persona que lo mira."
}
```

Los *objetos* comerciales —presupuestos que se pueden aceptar, secuencias que se detienen ante una respuesta, pruebas con criterios acordados de antemano, planes de acción mutuos— viven en el lienzo desde agosto, y siguen ahí. Esta es la otra mitad del mismo argumento: el lienzo es donde trabajas un trato concreto, y el hub es donde lees la forma de todos ellos a la vez.

## Dónde encaja en el método

En Alcance. Y Alcance ahora tiene una etapa menos que decir.

```bf-figure
{
  "kind": "screen",
  "frame": "La barra lateral izquierda",
  "ratio": 1.05,
  "regions": [
    { "label": "Idea", "note": "Lienzo", "x": 4, "y": 8, "w": 92, "h": 12, "hue": "idea" },
    { "label": "Crear", "note": "Proyectos, Talento / Plantilla, Calidad, Fiabilidad, Conocimiento", "x": 4, "y": 22, "w": 92, "h": 12, "hue": "make" },
    { "label": "Operar", "note": "Los nueve puestos de negocio", "x": 4, "y": 36, "w": 92, "h": 12, "hue": "run" },
    { "label": "Medir", "note": "Análisis", "x": 4, "y": 50, "w": 92, "h": 12, "hue": "measure" },
    { "label": "Alcance", "note": "Mercado · Desarrolladores · Centro de ventas", "x": 4, "y": 64, "w": 92, "h": 16, "hue": "reach" },
    { "label": "Expandir", "note": "Eliminada: un encabezado sobre una sola fila", "x": 4, "y": 82, "w": 92, "h": 10, "hue": "muted", "style": "ghost" }
  ],
  "caption": "Un encabezado con un único enlace debajo es una etiqueta, no una arquitectura de información."
}
```

La barra tenía antes una sexta etapa productiva llamada **Expandir**, y todo su contenido era el programa de ventas. La distinción que trazaba era bastante real sobre el papel —*Alcance* es poner la cosa delante de la gente, *Expandir* es hacer crecer el negocio a partir de ella— y le costaba a cada persona una palabra más que leer antes de encontrar nada.

Además, es una distinción que deja de ser cierta en el momento en que quien está delante es un fundador y no un asociado. Vender lo que has hecho y que te encuentren por ello son el mismo acto a distinto volumen. Así que Alcance lo absorbió, la pregunta del arco se alargó un poco —*véndelo, haz que te encuentren, hazlo crecer*— y el método entero vuelve a ser cinco palabras, que es lo que una persona puede repetir después de leer la barra una sola vez.

Esa es la prueba que esta navegación ha tenido que superar siempre. El menú es la metodología; si no puedes decir la metodología, el menú ha dejado de funcionar.

## El argumento de usar lo que vendes, sin rodeos

Builderforce vende un programa de ventas a sus propios asociados. Sería un producto extraño si vendiera uno y no se lo diera a quienes construyen empresas sobre él, y aún más extraño si lanzara un CRM, pasara por él sus propios ingresos durante meses y luego pidiera a sus clientes que se compraran otro.

Cada capacidad de esta plataforma es una que el fundador que la usa acabará necesitando. Esta la necesita el día en que lo que ha construido funciona.
