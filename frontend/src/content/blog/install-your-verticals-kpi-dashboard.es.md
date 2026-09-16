# Las métricas con las que tu sector realmente funciona, instaladas en un clic

Pregúntale a una fundadora de SaaS qué mira y te hablará de net revenue retention, magic number, periodo de recuperación. Hazle la misma pregunta a un fundador de biotecnología y ninguna de esas palabras significa nada: él mira el runway hasta la próxima lectura de resultados y la plantilla que le permite llegar hasta ahí.

Los dos, hasta ahora, abrían la misma pestaña de finanzas y veían los mismos tres números.

Ese es el fracaso silencioso de un panel genérico. No está equivocado. Simplemente no habla *de ti*, y un número que no habla de ti acaba siendo un número que dejas de abrir. La pestaña carga, el saldo de caja es correcto y nadie ha aprendido nada que no supiera ya.

## Ahora los paneles son plantillas

Un panel de KPI no es una funcionalidad que escribimos once veces. Es una **plantilla del marketplace**, igual que las que instalan un flujo de trabajo o un playbook: un pequeño manifiesto que declara qué métricas van juntas, pregunta el tamaño de la empresa y materializa un panel que ya funciona.

```bf-figure
{
  "kind": "flow",
  "title": "Del sector a un panel que significa algo",
  "steps": [
    { "label": "Declarar", "note": "El perfil de tu empresa ya conoce su sector. Nada nuevo que rellenar.", "hue": "read" },
    { "label": "Instalar", "note": "Una plantilla por sector, desde el Marketplace. Hace una sola pregunta —pequeña, mediana o grande— porque el rango saludable de una métrica cambia con el tamaño de la empresa.", "hue": "make" },
    { "label": "Medir", "note": "Los paneles se resuelven contra tus datos reales de finanzas y capital. Una métrica sin datos detrás aparece como no medida, nunca como cero.", "hue": "make", "tag": "en la pestaña de finanzas" }
  ],
  "caption": "Once paneles, un solo mecanismo. Añadir un duodécimo sector es un cambio de datos, no una versión nueva."
}
```

Hoy se incluyen diez sectores —IA/ML, SaaS, FinTech, salud digital, MedTech, BioTech, clima y energía, hardware y robótica, ciberseguridad y marketplaces— además de un panel de fundador para todos aquellos cuyo sector aún no tiene una cohorte propia.

## Nulo no es cero

El detalle que más tiempo llevó es el que nadie pide: qué hace una tarjeta cuando no tiene nada que mostrar.

Un panel que muestra una métrica no medida como `0` está mintiendo activamente. Una retención de ingresos neta de cero es una catástrofe; *aún no hay datos de NRR* es un martes cualquiera. En la mayoría de los paneles ambas cosas se ven idénticas, y el coste de eso es una fundadora que o bien entra en pánico por un número que no es real o —mucho más probable— aprende a desconfiar de toda la pantalla.

Así que una métrica sin datos detrás dice que no está medida, y no dice nada más. Sin ceros de relleno, sin un guion que pueda leerse como un valor, sin líneas de tendencia inventadas. Puedes ver de un vistazo cuáles de tus números son reales, que es el requisito previo para actuar sobre cualquiera de ellos.

```bf-figure
{
  "kind": "compare",
  "title": "Qué puede afirmar una tarjeta vacía",
  "columns": [
    { "title": "El panel habitual", "hue": "muted", "items": ["Muestra 0", "Dibuja una línea plana desde la nada", "La colorea de rojo", "La fundadora entra en pánico, o deja de mirar"] },
    { "title": "Aquí", "hue": "make", "items": ["Dice que la métrica no está medida", "No dibuja nada", "Deja la tarjeta en calma", "Los números reales siguen siendo legibles"] }
  ],
  "caption": "El valor de un panel se decide por cómo se comporta cuando le faltan datos, no por cómo se ve cuando está lleno."
}
```

## Dónde encaja en el método

Esto es **Measure**, el acto que sigue a Run. [Read y Prove](/blog/read-prove-build-the-inner-loop) te dicen si algo merece construirse; Build y Run lo ponen en marcha. Measure es donde descubres si sirvió de algo, y es el acto que más se salta, porque montar un panel ha sido históricamente un pequeño proyecto en sí mismo.

Convertir el panel en una plantilla reduce ese proyecto a una instalación. Lo que obtienes no es un punto de partida que configurar durante quince días: son los números por los que ya se juzga a empresas como la tuya, resueltos contra tus propios datos, en la pestaña que ya abres.

## Qué puedes hacer con esto hoy

- **Instala el panel de tu sector** desde el Marketplace, o desde el estado vacío de la pestaña de finanzas, que ya conoce tu sector y enlaza directamente con el correcto.
- **Léelo junto al runway y el flujo de caja**: el panel es una tercera pestaña del hub de finanzas, no un destino aparte.
- **Descubre qué números aún no estás midiendo**, dicho con claridad, para que instrumentar uno sea una decisión y no un accidente.
- **Ajusta los rangos a tu tamaño**: la misma métrica tiene una banda saludable distinta con diez personas que con cuatrocientas, y la plantilla lo pregunta una vez.
