Vor einem Jahr haben Sie den Code gelesen, bevor Sie ihn gemergt haben. Heute schreibt ein Agent an einem Nachmittag vierzig Dateien, und niemand liest alle vierzig. Mit Dokumenten geschieht dasselbe: Spezifikationen, Verträge, Recherchenotizen und Richtlinien, die ein Agent entworfen, überarbeitet und wieder neu entworfen hat.

Sie können nicht alles lesen, und Sie müssen es auch nicht. Was Sie brauchen, ist ein Urteil über die **Form**. Ist es so geschichtet, wie Sie es gemeint haben? Steht dasselbe zweimal da? Sagt ein Dokument das Gegenteil eines anderen? Führen die Links noch irgendwohin?

Bisher hat Ihnen das nichts gezeigt. Jetzt richten Sie BuilderForce auf einen Ordner, und es zeigt es Ihnen.

## Bitten Sie es, hinzusehen

In VS Code, in Rovr oder auf dem Web-Canvas tippen Sie `/review ./contracts` oder fragen einfach: „Prüf den Billing-Ordner“. In VS Code können Sie außerdem mit der rechten Maustaste auf einen Ordner klicken und **Review with BuilderForce** wählen.

Bevor irgendetwas läuft, sehen Sie, was die Prüfung tun wird: wie viele Dateien sie liest, wie viele sich seit dem letzten Mal nicht geändert haben und ungefähr wie viele Modellaufrufe und wie viel Geld die Bewertung kosten wird. Sie sagen Ja, und der Graph entsteht, während Sie zusehen.

```bf-figure
{
  "kind": "flow",
  "title": "Vom Ordner zum Graphen, mit dem Sie arbeiten können",
  "steps": [
    { "label": "Zeigen", "note": "Jeder Ordner: Code, Dokumente oder beides. Tippen Sie /review, fragen Sie in eigenen Worten oder klicken Sie ihn in VS Code mit rechts an.", "hue": "read" },
    { "label": "Bestätigen", "note": "Sehen Sie Dateianzahl, Unverändertes und die ungefähren Kosten, bevor etwas ausgegeben wird.", "hue": "accent", "tag": "Sie entscheiden" },
    { "label": "Sehen", "note": "Ein 3D-Graph des Ordners öffnet sich, jedes gefundene Problem ist bereits markiert.", "hue": "build" },
    { "label": "Beheben", "note": "Jeder Befund hat Fix with agent. Ein Klick übergibt die Anfrage an Ihren Composer.", "hue": "good" }
  ],
  "caption": "Eine zweite Prüfung liest nur die geänderten Dateien neu. Das Bild aktuell zu halten, kostet also fast nichts."
}
```

## Was Sie sehen

Der Ordner öffnet sich als 3D-Graph, den Sie mit Maus oder Finger drehen, zoomen und durchfliegen können. Code liegt auf Ebenen, eine pro Schicht. Dokumente liegen nach Ordner und Abschnitt. Je größer ein Knoten, desto mehr hängt der Rest des Ordners von ihm ab. Jeder Pfeil zeigt vom Nutzenden zum Genutzten, und die Pfeile, die Ihre Regeln brechen, leuchten auf.

```bf-figure
{
  "kind": "screen",
  "frame": "Ein geprüfter Ordner in VS Code",
  "ratio": 1.62,
  "regions": [
    { "label": "Der Ordner in 3D", "note": "Schichten als Ebenen, Bereiche als Cluster, Größe als Bedeutung", "x": 4, "y": 8, "w": 62, "h": 66, "hue": "build" },
    { "label": "Befunde", "note": "Gebrochene Schichten, Duplikate, Widersprüche, tote Links", "x": 69, "y": 8, "w": 27, "h": 44, "hue": "bad" },
    { "label": "Fix with agent", "note": "Bei jedem Befund", "x": 69, "y": 56, "w": 27, "h": 18, "hue": "good" },
    { "label": "Linsen", "note": "Struktur, Schichten, Duplikate, Aussagen, Links, Vergleich", "x": 4, "y": 80, "w": 62, "h": 14, "hue": "accent" },
    { "label": "Fragen", "note": "Beantwortet aus dem Gedächtnis", "x": 69, "y": 80, "w": 27, "h": 14, "hue": "read" }
  ],
  "caption": "Eine Ansicht auf jedem Host. VS Code, Rovr und der Web-Canvas zeichnen denselben Graphen desselben Ordners."
}
```

Wechseln Sie die Linse, um demselben Ordner eine andere Frage zu stellen:

- **Schichten.** Welche Dateien über ihre eigene Schicht hinausgreifen und welche eine Schleife bilden.
- **Duplikate.** Code, der von einer Stelle an eine andere kopiert wurde, und Abschnitte oder ganze Dokumente, die fast dasselbe sagen.
- **Aussagen.** Wo ein Dokument einem anderen widerspricht und wo sie übereinstimmen.
- **Links.** Jeder Verweis zwischen Dokumenten, die toten sind markiert.
- **Ungenutzt.** Dateien, Exporte und Abhängigkeiten, die nichts mehr verwendet.
- **Vergleich.** Diese Prüfung gegen die letzte, damit Sie sehen, was besser und was schlechter geworden ist.

Wählen Sie eine beliebige Datei und **verfolgen** Sie sie. Im Code erhalten Sie eine Schichtsequenz: welche Schicht welche aufgerufen hat und wo ein Aufruf eine Schicht übersprungen hat oder wieder nach oben geklettert ist. Bei Dokumenten sehen Sie, wie eines über Links und Zitate ein anderes erreicht. Beide Spuren lassen sich als Diagramm kopieren, das Sie in einen Pull Request einfügen können.

## Beheben, wo Sie es gefunden haben

Jeder Befund hat **Fix with agent**. Das öffnet keinen neuen Chat und kein separates Werkzeug. Es legt eine fertige Anfrage in den Composer, den Sie ohnehin nutzen: „Klon-Gruppe Nr. 3 zusammenführen“, „Den Datenbank-Import hinter einen Port verlegen“, „Abschnitt 4.2 von a.md mit Abschnitt 2 von b.md abgleichen“, „3 tote Links reparieren“. Sie lesen sie, ändern sie, wenn Sie möchten, und schicken sie ab. Wenn Sie etwas über eine Datei wissen, das sich der Graph merken soll, heftet **Add fact** es für jede Person und jeden Agenten im Projekt an diese Datei.

## Fragen, und oft braucht es kein Modell

Sobald ein Ordner geprüft ist, liegt er im Gedächtnis. Fragen dazu werden aus diesem Gedächtnis beantwortet statt durch erneutes Lesen jeder Datei.

```bf-figure
{
  "kind": "compare",
  "title": "Fragen zu einem Ordner",
  "columns": [
    { "title": "Vorher", "hue": "muted", "items": ["Sie stellen dem Agenten eine Frage", "Er öffnet und liest Datei um Datei", "Sie zahlen für jede gelesene Datei", "Morgen fragen Sie wieder, und er liest alles noch einmal"] },
    { "title": "Jetzt", "hue": "read", "items": ["Sie stellen dem Agenten eine Frage", "Die Antwort kommt aus dem Graphen im Gedächtnis", "Oft ganz ohne Modellaufruf erledigt", "Morgen fragen Sie wieder, und es geht genauso schnell"] }
  ],
  "caption": "/dup, /graph, /review und Fragen wie „Wo wird Billing behandelt?“ werden erkannt, bevor ein Modell gerufen wird. Ist sich der Graph sicher, antwortet er; wenn nicht, startet das Modell mit den Fakten, statt sie erst zu suchen."
}
```

Tippen Sie `/dup`, und die Duplikate werden aufgelistet. Tippen Sie `/graph`, und die Ansicht öffnet sich auf den Dateien, die Sie genannt haben. Fragen Sie „Was sagt der Mietvertrag zur Kündigung?“ oder „Wo wird Billing behandelt?“, und die Antwort kommt mit den Stellen zurück, aus denen sie stammt, und mit dem, was daneben liegt. Kann der Graph allein antworten, wird kein Modell gerufen und nichts ausgegeben. Kann er es nicht, startet das Modell mit den Fakten, die der Graph gefunden hat, statt Runden mit Suchen zu verbringen.

## Wo es in der Methode steht

Der Graph dient zwei Stationen auf dem Bogen von [Idea to Real](/blog/idea-to-real-the-operating-methodology), eine für jede Art von Ordner.

**Für Dokumente ist es Idea → Read.** [Read](/blog/read-prove-build-the-inner-loop) stellt eine einzige Frage: *Was haben Sie eigentlich gesagt?* Wenn „was Sie gesagt haben“ aus dreißig Spezifikationen und einem Ordner voller Verträge besteht, gehören zur ehrlichen Antwort auch die Stellen, an denen sie sich widersprechen. Bisher fand man die nur, indem man jede Datei las. Jetzt stehen Widersprüche, Beinahe-Kopien und tote Links auf dem Bildschirm, bevor jemand entscheidet, was gebaut wird, und Read bleibt der günstige Schritt, der er sein soll.

**Für Code ist es Make → Build.** Build ist der Schritt, der Geld kostet: Agenten, Laufbudget, Deployments. Seine Frage lautet *Ist es echt?*, und sobald Agenten die Zeilen schreiben, hängt die Antwort von der Form ab: Hält es seine Schichten ein, ist es nur einmal gebaut, nutzt das hier noch irgendetwas? Zeile-für-Zeile-Review skaliert nicht mehr, wenn Sie die Zeilen nicht mehr selbst schreiben. Die Form zu beurteilen, skaliert sehr wohl, und eine gebrochene Schicht, die am Tag ihres Entstehens auffällt, ist weit billiger als dieselbe, die man erst findet, nachdem sich drei weitere Features darauf gestützt haben.

## Was Sie heute damit tun können

- **Jeden Ordner prüfen**, Code oder Dokumente, aus VS Code, Rovr oder dem Web-Canvas, und vorher sehen, was es kostet.
- **Sehen, wo Ihre Schichten brechen** und welche Dateien eine Schleife bilden, auf einem Graphen, den Sie durchfliegen können.
- **Duplizierten Code und fast gleiche Dokumente finden**, bevor sie auseinanderlaufen.
- **Dokumente erkennen, die sich widersprechen**, und Links, die nirgendwohin mehr führen.
- **Jede Datei verfolgen** durch die Schichten oder Dokumente, die sie erreicht, und die Spur als Diagramm kopieren.
- **Jeden Befund mit einem Klick von einem Agenten beheben lassen**, aus dem Composer, den Sie schon nutzen.
- **Fragen zum Ordner stellen** und Antworten aus dem Gedächtnis bekommen, oft ohne für einen Modellaufruf zu zahlen.
- **Die technischen Schulden sinken sehen**, indem Sie diese Prüfung mit der letzten vergleichen.

---

**Weiterlesen:** [Read, Prove, Build: die innere Schleife](/blog/read-prove-build-the-inner-loop) · [Memory-first Inference: das LLM überspringen](/blog/memory-first-inference-skip-the-llm) · [Ein lokaler Index für jedes KI-Werkzeug](/blog/one-local-index-for-every-ai-tool)

[Öffnen Sie einen Canvas](/create) und tippen Sie `/review`, gefolgt von dem Ordner, den Sie nicht mehr lesen.
