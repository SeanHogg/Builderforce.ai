Abre Builderforce.ai sin iniciar sesión y comparte un tablero, y funciona igual que compartir en cualquier otro sitio: un enlace, un botón Copiar, y se lo envías a quien quieras. Lo abre, está en tu tablero y los dos están editando.

Regístrate, y eso se acababa.

El mismo panel, en un tablero que te habías molestado en guardar, se convertía en un campo de dirección. Escribe un correo. Enviamos un token de un solo uso. El destinatario tiene que iniciar sesión **con esa dirección exacta** antes de ver nada: necesita una cuenta, tiene que haber revisado la bandeja de entrada correcta y, si se registró con su correo personal en lugar del de trabajo que escribiste, el enlace le dice que se vaya.

El modelo de compartir del producto empeoraba justo en la transición que más se esfuerza por provocar.

## Ahora cualquier lienzo guardado puede generar un enlace

```bf-figure
{
  "kind": "flow",
  "title": "De un tablero a otra persona dentro de él",
  "steps": [
    { "label": "Crear", "note": "Abre el panel de invitación en cualquier lienzo guardado, elige ver, comentar o editar, y obtén una URL.", "hue": "idea" },
    { "label": "Enviar", "note": "Como ya envías cualquier cosa. Es un enlace: una ventana de chat, un mensaje, una invitación de calendario.", "hue": "make" },
    { "label": "Unirse", "note": "Se le indica qué tablero es y qué puede hacer en él, y después elige: unirse con un nombre, iniciar sesión o crear una cuenta.", "hue": "run", "tag": "sin registro" }
  ],
  "caption": "La invitación por correo no ha desaparecido. Las dos opciones conviven en el mismo panel, porque cuál encaja depende de si conoces el correo de la persona o solo tienes abierta una ventana de chat."
}
```

El campo de dirección sigue ahí, y sigue siendo lo adecuado para el caso para el que se creó: alguien a quien vas a incorporar al equipo y cuyo correo conoces. El enlace es para el otro caso, que es casi siempre: la persona que está en la llamada ahora mismo, el cliente en un hilo de chat, el amigo al que quieres pedirle una segunda opinión antes de comer.

```bf-figure
{
  "kind": "screen",
  "frame": "El panel de invitación en un lienzo guardado",
  "ratio": 1.5,
  "regions": [
    { "label": "Invitar por enlace", "note": "Elige el acceso, crea el enlace y cópialo. Se muestra una sola vez: solo se guarda su hash.", "x": 6, "y": 10, "w": 88, "h": 30, "hue": "idea" },
    { "label": "Invitar por correo", "note": "Sin cambios. Para la persona cuyo correo conoces.", "x": 6, "y": 44, "w": 88, "h": 20, "hue": "make" },
    { "label": "Miembros e invitaciones pendientes", "x": 6, "y": 68, "w": 88, "h": 16, "hue": "run" },
    { "label": "Enlaces activos · revocar", "note": "Cada enlace que has creado, lo que concede y cuántas veces se ha usado", "x": 6, "y": 86, "w": 88, "h": 10, "hue": "accent" }
  ],
  "caption": "Un solo panel, las dos opciones. La lista de enlaces activos no muestra URL a propósito: solo se guarda un hash, así que un enlace filtrado se revoca y se vuelve a generar, en lugar de volver a leerse."
}
```

## Quien lo abre no necesita una cuenta

Esta es la parte que importa, y la que el flujo anterior no podía hacer en absoluto.

Abre el enlace y se te indica a qué tablero te han invitado y exactamente qué puedes hacer en él —ver, comentar o editar— antes de reclamar nada. Después tienes tres opciones, y la primera es *unirte sin cuenta*. Escribe un nombre. Ya estás en el tablero.

No en una vista previa del tablero. **En el tablero.** Tu cursor está en él, tus cambios se guardan, tus comentarios llevan tu nombre, y quien te invitó te ve llegar como a cualquier otro colaborador. No se oculta nada y nada es una demo.

```bf-figure
{
  "kind": "compare",
  "title": "Lo que cuesta ver el tablero de otra persona",
  "columns": [
    { "title": "Antes", "hue": "muted", "items": ["Que te pidan tu dirección de correo", "Esperar el correo", "Encontrarlo", "Crear una cuenta", "Verificar la dirección", "Iniciar sesión con esa dirección exacta", "Ver, por fin, el tablero"] },
    { "title": "Ahora", "hue": "run", "items": ["Abrir el enlace", "Escribir un nombre", "Ya estás en el tablero"] }
  ],
  "caption": "Las dos columnas terminan con el mismo acceso. Una de ellas llega a él en unos cuatro segundos."
}
```

Que sea una identidad real y no un simple pase para mirar tiene varias consecuencias:

- **No le cuesta al espacio de trabajo nada facturable.** Un colaborador de lienzo nunca ha sido una licencia de pago, y un invitado por enlace es uno de ellos. Lo que los limita es el tope de colaboradores que el plan ya anuncia.
- **Un enlace concede ver, comentar o editar, y nada más.** Nunca puede conceder los dos roles que sería peligroso reenviar: ejecutar agentes (que gasta los tokens del espacio de trabajo) y la propiedad (que permite ceder el tablero). Una URL no tiene permitido expresar esas opciones.
- **El acceso que diste al tablero es el techo de todo lo demás.** Alguien invitado a comentar no puede editar el espacio de trabajo que lo rodea.
- **Puedes crear una cuenta más adelante.** Abre el mismo enlace con la sesión iniciada y se asignará la cuenta que acabas de crear, en el mismo tablero y con el mismo acceso.

Y se puede revocar como debe poder revocarse un enlace: cada enlace que has creado aparece en el mismo panel, con lo que concede, cuántas personas lo han usado y un botón para anularlo.

## Dónde encaja en el método

**Leer** y **Demostrar** son los dos primeros actos, y son los baratos, a propósito, para que la decisión de crear sea una decisión y no una inercia. Pero los dos se hacen *con otras personas*. Leer el panorama significa que alguien que lo conoce revise lo que encontraste. Demostrar significa poner la versión más afilada de la idea delante de la persona con más probabilidades de decirte que te equivocas.

Lo que acaba con eso no es la lectura ni la demostración. Es la invitación.

```bf-figure
{
  "kind": "compare",
  "title": "Quién ve realmente el tablero",
  "columns": [
    { "title": "Cuando la invitación exige una cuenta", "hue": "muted", "items": ["Las dos personas que ya están en el espacio de trabajo", "Quien esté dispuesto a crearse una cuenta para hacerte un favor", "Nadie con prisa", "Nadie a quien hayas conocido hace diez minutos"] },
    { "title": "Cuando es un enlace", "hue": "idea", "items": ["La persona que está en la llamada", "El cliente del hilo de chat", "La experta que te debe veinte minutos", "El cliente al que le estás demostrando la idea"] }
  ],
  "caption": "El paso Demostrar solo vale tanto como la persona a la que se lo enseñas. Una invitación que exige registrarse filtra por paciencia, no por criterio."
}
```

Cada registro que pones delante de un revisor es un filtro, y filtra lo que no debe: se queda con la gente a la que ya le caes bien y pierde a quienes tienen una opinión que habría cambiado la idea. El tablero es donde una idea se convierte en algo que la gente puede discutir. Debería estar al alcance de cualquiera a quien puedas enviarle un enlace.

## Qué puedes hacer hoy

- **Comparte cualquier lienzo guardado con una URL**: elige ver, comentar o editar, copia y envía.
- **Deja que alguien se una escribiendo un nombre**: sin registro, sin contraseña, un colaborador real en tu tablero.
- **Invita por correo como antes** cuando conozcas la dirección y quieras incorporar a esa persona al equipo.
- **Revoca cualquier enlace** desde el mismo panel, en cualquier momento, sin afectar a nadie que ya se haya unido.
- **Convierte más adelante a un invitado en una cuenta**: crea una y abre el mismo enlace para conservar el acceso.

---

**Lecturas relacionadas:** [Crea antes de registrarte](/blog/create-before-you-sign-up) · [Multijugador en el lienzo, en el navegador y en VS Code](/blog/multiplayer-creation-canvas-web-vscode) · [El Lienzo de Creación no es una ventana de chat](/blog/creation-canvas-beyond-chat)

[Abre un lienzo](/create) y envíale el enlace a alguien.
