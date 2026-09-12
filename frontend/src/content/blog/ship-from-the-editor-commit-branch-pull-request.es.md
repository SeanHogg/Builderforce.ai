Hace una semana, [ver lo que cambió el agente](/blog/see-what-the-agent-changed-before-you-commit) cerró la mitad de un hueco. La otra mitad se quedó abierta a propósito, y aquel artículo lo decía: ningún verbo para hacer commit, ninguno para hacer push, porque lo que un agente local puede hacerle a tu remoto es una decisión de gobernanza, y lanzar los verbos antes que la decisión habría sido entregarte un agente capaz de hacer push a una rama protegida por iniciativa propia.

La decisión ya está tomada. Esto es en lo que se ha convertido.

## Cómo era antes

Conviene concretar, porque el fallo no era «faltaba una función». Era peor: al agente se le había *dicho* que podía publicar, y no podía.

La persona del editor terminaba con una frase que venía a decir *usa `run_command` para git — para hacer commit, push y abrir un PR cuando el usuario quiera publicar.* Un consejo sin ninguna herramienta detrás. Así que, cuando alguien pidió a un agente que hiciera commit de un arreglo de CSS de una línea y lo subiera, pasó esto:

```bf-figure
{
  "kind": "flow",
  "title": "Una sola petición, y cada paso saliendo mal",
  "steps": [
    { "label": "«haz commit del cambio y súbelo a main»", "note": "La edición ya está hecha y es correcta", "hue": "idea" },
    { "label": "git_status falla", "note": "La carpeta abierta contiene varios checkouts, así que no hay ningún repositorio en su raíz", "hue": "bad", "tag": "1" },
    { "label": "git_sync_latest no se puede acotar", "note": "No aceptaba ningún argumento `repo`, a diferencia de git_status, que sí", "hue": "bad", "tag": "2" },
    { "label": "Rebusca en el catálogo de herramientas", "note": "No hay ningún verbo de commit que encontrar; `run_command` se había recortado de ese turno", "hue": "bad", "tag": "3" },
    { "label": "git add -A && git commit && git push", "note": "Todos los archivos de un árbol de trabajo compartido, sin revisar, directos a main", "hue": "bad", "tag": "4" }
  ],
  "caption": "Cuatro defectos independientes, una sola petición. El último es el peligroso, y es el que los tres primeros hicieron inevitable."
}
```

El paso cuatro es el que hay que digerir. El árbol de trabajo tenía tres archivos modificados. El agente había tocado uno. `git add -A` no distingue, y tampoco lo hace un agente al que nunca se le pidió que lo dijera.

## La forma de la respuesta

Tres herramientas, y el camino seguro es el que está al alcance.

```bf-figure
{
  "kind": "flow",
  "title": "La ruta por defecto",
  "steps": [
    { "label": "git_commit", "note": "Nombra las rutas exactas que ha cambiado y la rama del ticket donde ponerlas; la rama se crea por ti", "hue": "make" },
    { "label": "git_push", "note": "Sube esa rama y configura su upstream la primera vez", "hue": "run" },
    { "label": "open_pull_request", "note": "Abre el PR contra la rama base y puede solicitar revisores por nombre", "hue": "prove" },
    { "label": "Una persona lee el diff", "note": "Que era de lo que se trataba", "hue": "measure" }
  ],
  "caption": "Nada de esto es nuevo como flujo de trabajo. Lo nuevo es que ahora es el camino de menor resistencia para el agente, y no algo que esperabas que eligiera."
}
```

**`git_commit` te obliga a listar las rutas.** No es un trámite. Tu árbol de trabajo lo compartes con alguien: tú, la persona sentada delante, a mitad de una idea, con otros dos archivos abiertos y a medio editar. `git add -A` los arrastra al commit del agente y al pull request del agente, y de repente tu trabajo, que no tiene nada que ver, está en la revisión de otra persona. Un agente que no sabe decir qué archivos ha cambiado no tiene por qué hacer commit, así que la herramienta no le deja escurrir el bulto.

**Hacer commit en la rama base está vetado.** Pasa `branch` y cambia a esa rama del ticket, creándola si no existe. Omítelo estando en `main` y recibirás un error que te indica la solución en lugar de un fatal de git.

**`open_pull_request`** sube primero la rama si no tiene upstream y luego abre el PR con tu propia sesión de `gh`: no pasa ningún token por el agente, porque la máquina ya tiene uno. Si `gh` no está instalado, te dice que la rama ya tiene su commit y está subida, y te da el nombre de la rama, que es la diferencia entre una herramienta que ha fallado y un trabajo que se ha perdido.

## Subir a main es un acto declarado

Puedes seguir haciéndolo. Solo que ya no puede ocurrir por accidente, ni por iniciativa de un agente.

```bf-figure
{
  "kind": "compare",
  "title": "«Sube esto a main»",
  "columns": [
    { "title": "Antes", "hue": "bad", "items": ["Sin herramienta: acaba en una shell sin más", "`git add -A` prepara lo que haya", "Directo a la rama base", "El aviso de aprobación dice: run: git add -A && git com…", "Nada ofrecía un pull request, porque nada podía"] },
    { "title": "Ahora", "hue": "good", "items": ["El agente ofrece primero un pull request y explica por qué", "Solo se preparan las rutas que nombra", "Rechazado salvo que se establezca `allowBaseBranch`", "El aviso dice: «subir a la RAMA BASE (main) — omite la revisión del pull request»", "Tú apruebas ese acto concreto, o no"] }
  ],
  "caption": "La fila del medio es la decisión de gobernanza. La cuarta es lo que la convierte en una decisión real: una aprobación que no puedes leer no es una aprobación."
}
```

Todas estas herramientas modifican estado, así que pasan por el mismo punto de aprobación que `write_file` y `delete_file`. Ese punto ya existía; lo que le faltaba era algo que valiera la pena leer. `git_push` en un diálogo de confirmación no te dice nada sobre lo único que necesitas sopesar. *Subir a la RAMA BASE (main) — omite la revisión del pull request* te lo dice todo.

Además, dependen de una nueva capacidad `git.write` en lugar de `shell`. Suena a contabilidad y no lo es: las superficies en la nube también tienen shell, y ya publican mediante un mecanismo completamente distinto: allí una escritura **es** un commit, y la ejecución abre su pull request al terminar. Darles una segunda vía, sin implementar, hacia el mismo acto haría aparecer herramientas para las que su runtime no tiene manejador, y eso falla a mitad de ejecución. Una capacidad, una superficie, una forma de publicar por carril.

## El arreglo discreto de fondo

Merece la pena explicar por qué el agente fue a buscar `run_command` en primer lugar, porque es una clase de bug y no un incidente aislado.

El catálogo tiene unas 440 herramientas. En cada turno se anuncian unas 64, elegidas por relevancia léxica respecto a lo que pediste. `run_command` no comparte ninguna raíz con «haz commit del cambio y súbelo a main», así que, justo en el turno que la necesitaba, quedó recortada. El agente leyó sus propias instrucciones, fue a buscar la herramienta que nombraban y no pudo encontrarla.

Las nueve herramientas de git están ahora fijadas de forma incondicional, junto a las herramientas de archivos. La relevancia es una forma razonable de elegir entre dominios. No es una forma razonable de decidir si el agente puede tocar el espacio de trabajo en el que está sentado.

## Dónde encaja en el método

Este es el paso **Crear** de [Leer, Demostrar, Crear](/blog/read-prove-build-the-inner-loop) llegando por fin a su propio final, y el traspaso **Crear → Operar** del arco [Idea → Crear → Operar → Medir](/blog/idea-make-run-measure-menu-as-methodology).

La versión anterior hizo *visible* el traspaso: había código en disco, no se había hecho commit de nada, y ahora podías verlo y leer cada diff. Pero visible no es lo mismo que transitable. Podías inspeccionar el trabajo y luego tenías que salir de la herramienta para moverlo, lo que significa que el arco tenía una costura justo donde una metodología debería ser continua, y cada cambio local se convertía, sin que nadie lo notara, en un paso manual que alguien tenía que recordar.

Lo que lo cierra no es «el agente ya puede hacer push». Es que la salida de Crear aterriza por defecto en **Demostrar** —un pull request, un diff, un revisor— en lugar de aterrizar en Operar saltándose la revisión. Hacer commit en una rama de ticket y abrir un PR es más lento que hacer push a `main` exactamente en un paso, y ese paso es aquel en el que una persona mira el cambio. Hacer que el camino revisado sea el camino por defecto es todo el argumento.

Subir a la rama base sigue disponible porque a veces es realmente lo correcto, y una metodología que finge lo contrario acaba esquivándose. Solo te cuesta una frase diciéndolo, y un aviso que te dice qué estás aprobando.

## Qué puedes hacer con esto hoy

- **Pide un cambio y luego pide publicarlo**, y recibe a cambio una rama de ticket y la URL de un pull request, no un comando de shell que tengas que auditar.
- **Confía en que solo está tu cambio**, porque el agente tuvo que nombrar los archivos.
- **Di «súbelo a main» y recibe a cambio la oferta de una revisión**, y aun así obtén tu push si confirmas que era lo que querías.
- **Solicita revisores por nombre** en el pull request que abre el agente.
- **Trabaja en una carpeta que contiene varios checkouts**, algo que ahora gestionan todas las herramientas de git: pasa `repo` y cada una se acota al correcto. `git_sync_latest`, `git_undo` y `git_redo` no podían hacerlo antes y fallaban en la raíz del espacio de trabajo sin nada que explicara el motivo.

---

**Lecturas relacionadas:** [Ve lo que cambió el agente, antes de hacer commit](/blog/see-what-the-agent-changed-before-you-commit) · [Puntos de aprobación y supervisión humana](/blog/approval-gates-and-human-oversight) · [VS Code como centro de mando de tu fuerza de trabajo agéntica](/blog/vs-code-command-center-for-your-agentic-workforce)

Instala la [extensión de BuilderForce para VS Code](https://marketplace.visualstudio.com/items?itemName=BuilderForce.builderforce-ai), pide a un agente que arregle algo y luego pídele que lo publique.
