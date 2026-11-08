Ein Assistent, der den Workspace nur beschreiben kann, überlässt dem Nutzer jede wesentliche Änderung. Ein Assistent mit uneingeschränktem Zugriff auf den Zustand erzeugt das gegenteilige Problem: Niemand kann nachvollziehen, was er geändert hat oder ob er eine Grenze überschritten hat.

Brain verfolgt ein drittes Modell. Auf der Creation Canvas ist es ein **Operator mit klar abgegrenztem Wirkungsbereich** – mit expliziten Tools, objektspezifischen Verträgen und einem prüfbaren Vorschlagspuffer.

![Produktansicht von Brain bei der Arbeit an einem ausgewählten Frame, mit den Scope-Steuerungen Canvas, Auswahl und Frame sowie einer Prüfschublade, die vor dem Anwenden vorgeschlagene Änderungen an Objekten, Feldern, Layout, Verbindungen und nativen Aktionen auflistet](/blog/brain-canvas-operator-workspace.svg)

## Der Scope ist Teil der Anfrage

Der Composer kann die gesamte Canvas, die aktuelle Auswahl oder einen Frame adressieren. Brain erhält nur die Objekte und Beziehungen innerhalb dieses aufgelösten Scopes. Jedes Objekt steuert eine inhaltlich unbedenkliche Kontextansicht bei: seine Art, seinen Titel, unterstützte strukturierte Belege, den aktuellen Status, deklarierte Aktionen, veränderbare Felder, das Layout und Beziehungsmetadaten.

Dadurch sind „bewerte das“ und „bewerte den gesamten Launch-Plan“ substanziell verschiedene Anfragen. Der Scope ist sichtbarer Zustand, keine Vermutung, die aus der Formulierung im Gespräch abgeleitet wird.

## Brain arbeitet über explizite Canvas-Tools

Brain kann einen Snapshot lesen; ein Objekt hinzufügen, aktualisieren, löschen, anordnen, ausblenden oder sperren; Objekte verbinden; eine Verbindung aktualisieren oder entfernen; und Aktionen aufrufen, die eine Objektart deklariert. Vor dem Erstellen liest es die Registry, sodass ein Chart, ein Agent, eine Roadmap, eine Website und ein Evermind jeweils unterschiedliche unterstützte Felder und Aktionen bereitstellen.

Unbekannte Mutationsfelder werden abgelehnt. Sensible Schlüssel wie Secrets, Tokens, Passwörter, Zugangsdaten, Autorisierungswerte, API-Schlüssel und Cookies werden sowohl aus Mutations-Payloads als auch aus dem KI-Kontext herausgefiltert. Grenzen für Strings, Arrays, Objekte und Verschachtelungstiefe halten den Kontext begrenzt.

![Brain liest einen Scope-Snapshot und die Objekt-Registry, führt erstellte Felder durch Allowlists und Filter für sensible Daten und legt Änderungen an Objekten, Layout, Verbindungen und Aktionen in einem auswählbaren Vorschlagssatz ab, bevor freigegebene Änderungen den Canvas-Zustand erreichen](/blog/brain-review-before-mutation.svg)

## Eine Mutation ist ein Vorschlag, kein Nebeneffekt

Wenn Brain eine Evaluation anlegen, eine Präsentation umordnen, ein Dataset mit einem Chart verbinden oder eine Workflow-Aktion aufrufen möchte, hält es eine vorgeschlagene Änderung fest. Die Oberfläche kann den Satz als konkrete Operationen anzeigen: dieses Objekt hinzufügen, diese Felder aktualisieren, diese IDs verbinden, dieses Artefakt anordnen, diese Aktion aufrufen.

Der Nutzer entscheidet, was angewendet wird. Eine Antwort über mehrere Objekte bleibt damit in derselben Granularität prüfbar wie die Canvas selbst.

Operative Aktionen erhalten eine zusätzliche Grenze. Hinweise zum Prüfen und Bearbeiten können sofort zurückgegeben werden. Ausführungen, Auslieferung, Veröffentlichung, Training, Integrationen und andere folgenreiche Aktionen werden zur Prüfung vorgeschlagen. In einer lokalen anonymen Session öffnen Aktionen, die dauerhafte Ressourcen benötigen, das Konto-Gate, ohne die Canvas zu verändern.

## Native Fähigkeiten bleiben beim Objekt

Brain simuliert nicht jede Funktion innerhalb einer Chat-Antwort. Es ruft Fähigkeiten auf, die das ausgewählte Objekt deklariert. Ein Dataset kann profilieren oder visualisieren. Ein Projekt kann sich erweitern oder verglichen werden. Ein Mockup kann ausgeliefert werden. Ein Evermind kann trainieren, evaluieren oder veröffentlichen. Ein Stand-up kann starten.

So bleibt es bei einem einzigen Vertrag zwischen manueller und KI-gestützter Nutzung. Die Schaltfläche im Inspector und die Brain-Aktion adressieren dieselbe Objektfähigkeit, dieselben Berechtigungen und dasselbe resultierende Artefakt.

## Das Ergebnis ist nachvollziehbare Handlungsfähigkeit

Das Ziel ist nicht maximale Autonomie. Es ist **nachvollziehbare Handlungsfähigkeit**: Brain versteht die Arbeit als strukturierte Objekte, kann auf diesen Objekten operieren und hinterlässt zwischen Absicht und Änderung eine exakte Prüfoberfläche.

Genau das macht die Canvas zu mehr als einem Chat mit Karten drumherum. Brain kann an der Arbeit teilhaben, ohne sie undurchsichtig zu machen.

[Creation Canvas öffnen →](/create/new)
