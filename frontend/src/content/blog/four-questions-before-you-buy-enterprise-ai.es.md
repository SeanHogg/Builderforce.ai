Toda evaluación de IA empresarial empieza como una conversación sobre modelos y termina como una conversación sobre cuatro cosas que no tienen nada que ver con los modelos.

Los clientes no nos pedían un modelo mejor. Nos preguntaban esto:

```bf-figure
{
  "kind": "stack",
  "title": "Las cuatro, en el orden en que se preguntan",
  "bands": [
    { "label": "¿Puede leer nuestros datos?", "note": "No un corpus de demostración. Nuestras exportaciones, nuestros documentos, nuestros tickets, nuestras políticas, en los formatos en que realmente están.", "hue": "idea" },
    { "label": "¿Filtrará datos entre tenants?", "note": "No \"filtramos por id de cliente\". ¿Qué pasa cuando falta el filtro?", "hue": "run" },
    { "label": "¿Cuánto costó esa respuesta?", "note": "Por respuesta, atribuible, no una factura mensual con una sola cifra.", "hue": "measure" },
    { "label": "¿Cómo sabemos que está mejorando?", "note": "Una puerta que un cambio tiene que superar, no un registro de cambios que dice que mejoró.", "hue": "prove" }
  ],
  "caption": "Un proveedor que responde bien a tres de ellas y esquiva la cuarta te pide que te fíes de la cuarta, y la cuarta es la que decide si la herramienta seguirá siendo buena dentro de un año."
}
```

Así se ve cada respuesta cuando es de verdad.

## 1 · La ingesta es un solo camino, no una sola demo

El modo de fallo es un sistema que lee Markdown de maravilla y trata todo lo demás como un adjunto. Los corpus reales son mixtos: documentos de políticas, tickets exportados, hojas de cálculo, páginas HTML, un CSV que alguien generó a partir de un informe hace seis años.

Un único pipeline los maneja todos, y la diferencia entre ellos es qué analizador se ejecutó, no qué producto tuviste que comprar. Las filas estructuradas y la prosa no estructurada llegan al mismo índice por el mismo camino, y eso es lo que permite responder una pregunta con ambas a la vez.

Detalles que resultan importar en la práctica: conservar la ruta de encabezados de un documento para que un fragmento recuperado sepa de dónde viene, y recuperar números y booleanos de las hojas de cálculo **sin** estropear las cadenas con forma de identificador: un ID de `007` no es el número siete, y un sistema que decide lo contrario corrompe en silencio cada referencia a él.

## 2 · El aislamiento de tenants está compilado y falla cerrado

```bf-figure
{
  "kind": "compare",
  "title": "Dos maneras de mantener a un cliente fuera de los datos de otro",
  "columns": [
    { "title": "Un filtro añadido en el punto de llamada", "hue": "bad", "items": ["Correcto en cada ruta de código que alguien recordó", "Una ruta de código nueva es una nueva oportunidad de olvidarlo", "El fallo es silencioso y parece una buena respuesta", "Te enteras por el cliente"] },
    { "title": "Compilado en la recuperación, fallando cerrado", "hue": "good", "items": ["Una consulta sin ámbito de tenant no devuelve nada", "Los filtros son DATOS que el adaptador debe respetar", "Las lecturas entre tenants se DECLARAN, nunca son incidentales", "La ausencia de ámbito es un error, no un comodín"] }
  ],
  "caption": "La propiedad que conviene exigir en una demo: pregunta qué pasa cuando falta el ámbito del tenant. \"Todo\" y \"nada\" son productos muy distintos."
}
```

## 3 · Coste y traza en cada respuesta

Un sistema de IA cuyo coste llega como una sola cifra mensual no se puede gestionar. No puedes saber qué flujo de trabajo es caro, qué equipo lo impulsa ni si la respuesta valió los tokens.

La telemetría por respuesta —qué se recuperó, qué se invocó, cuánto costó— es lo que convierte eso en algo que un área financiera puede sostener y un equipo de ingeniería puede mejorar. También es lo que hace posible responder la cuarta pregunta, porque no puedes demostrar que un cambio fue una mejora sin una línea base que ya estuvieras registrando.

## 4 · Una puerta de evaluación, no un registro de cambios

La versión honesta de «está mejorando» es un conjunto de casos que el sistema tiene que superar antes de que un cambio salga, ejecutado en cada cambio y con los fallos a la vista. No una puntuación de benchmark en un anuncio de lanzamiento, sino una puerta en el pipeline que puede decir *no*.

Esta es la pregunta que la mayoría de los proveedores maneja peor, porque es la única que los limita. Una puerta que puede bloquear una versión es una puerta que acabará bloqueando una versión que alguien quería.

## Y la aburrida: cómo inicia sesión la gente

El inicio de sesión único empresarial está activo sobre OpenID Connect, apuntando al proveedor de identidad que el cliente ya use.

Deliberadamente no terminamos SAML nosotros mismos. Lo difícil de SAML es verificar una respuesta firmada —canonicalización, validación del resumen, comprobación de la firma, leyendo las declaraciones del subárbol que realmente se verificó—, y un error en cualquier punto de esa secuencia es una evasión de autenticación por envoltura de firma cuya propiedad definitoria es que se ve exactamente igual que un inicio de sesión que funciona hasta que alguien falsifica una aserción. Los clientes apuntan su IdP actual a una pasarela SSO de su elección; nada en nuestro esquema nombra a un proveedor.

Tener claro qué has elegido *no* implementar forma parte de responder la segunda pregunta.

---

**Lecturas relacionadas:** [Evermind — el modelo que se actualiza solo](/blog/evermind-self-updating-model) · [Dentro de la arquitectura de Evermind](/blog/inside-evermind-architecture) · [Seguridad y arquitectura multi-tenant](/blog/security-and-multi-tenant-architecture)

Lee la [descripción general de Evermind](/evermind), o lleva las preguntas a una [conversación](/book-demo).
