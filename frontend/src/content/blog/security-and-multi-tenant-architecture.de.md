Alle Teams auf Builderforce teilen sich dieselbe API-Infrastruktur. Kein Team kann die Projekte, Agents, Aufgaben oder Unterhaltungen eines anderen Teams sehen. Diese Isolation ist kein nachträglich angeschraubtes Feature – sie ist die grundlegende Architekturannahme, auf der jede Datenbankabfrage, jede API-Route und jeder Agent-Dispatch aufbaut.

Dieser Beitrag erklärt das Vertrauensmodell, das Zugriffskontrollsystem, wie die Authentifizierung von Agents funktioniert und was der Audit-Trail abdeckt.

![Diagramm der mandantenfähigen Sicherheit von Builderforce: drei isolierte Mandantenbahnen, getrennt durch verschlossene Wände, drei Authentifizierungsmechanismen (Web-JWT, gehashter AgentHost-API-Schlüssel, HMAC-SHA256-Dispatch-Signatur) und Isolation auf Abfrageebene, bei der jede mandantenbezogene Abfrage einen eq(tenantId)-Filter trägt](/blog/security-multitenant.svg)

---

## Das Mandantenmodell

Ein **Mandant** ist der isolierte Workspace Ihrer Organisation auf Builderforce. Alle Ressourcen – Projekte, Aufgaben, AgentHosts, Agents, Skills, Freigaben, Unterhaltungen – sind einem Mandanten zugeordnet. Es gibt keine mandantenübergreifende Sichtbarkeit und keine mandantenübergreifende Freigabe.

Benutzer gehören einem oder mehreren Mandanten an, mit jeweils einer bestimmten **Rolle**:

| Rolle | Was sie darf |
|---|---|
| `viewer` | Nur-Lese-Zugriff auf Projekte, Aufgaben, Chatverlauf und Observability |
| `developer` | Lese- und Schreibzugriff auf Projekte und Aufgaben; kann mit der IDE und dem Chat arbeiten |
| `manager` | Voller Developer-Zugriff plus: Freigabe-Gates genehmigen/ablehnen, AgentHost-Instanzen verwalten, Skills zuweisen, Mitglieder verwalten |
| `owner` | Voller Manager-Zugriff plus: Abrechnung, Löschen des Mandanten, Source-Control-Integrationen |

Rollen werden auf der API-Ebene durchgesetzt – jeder geschützte Endpunkt prüft die Rolle des Aufrufers gegen das erforderliche Minimum, bevor er die Anfrage verarbeitet. Versucht ein Developer, ein Freigabe-Gate zu genehmigen, erhält er ein `403`.

---

## Authentifizierung

Builderforce verwendet ein **duales Token-Authentifizierungsmodell**, das Browser-Sessions sauber vom API-Zugriff durch Agents trennt.

### Web-JWT (Benutzer-Sessions)

Browserbasierte Benutzer authentifizieren sich mit E-Mail und Passwort und erhalten ein kurzlebiges JWT. Das Token kodiert:

- `userId` – den authentifizierten Benutzer
- `tenantId` – den Mandantenkontext dieser Session
- `role` – die Rolle des Benutzers in diesem Mandanten
- `exp` – den Ablauf (kurzlebig; erneuerbar)

Alle JWT-Operationen laufen über die `/api/auth`-Routen. Tokens lassen sich auf der Seite mit den Sicherheitseinstellungen einzeln widerrufen.

### Multi-Faktor-Authentifizierung

Benutzer können TOTP-basierte MFA unter [Einstellungen → Sicherheit](/security) aktivieren. Danach ist bei jeder Anmeldung zusätzlich zum Passwort der TOTP-Code erforderlich.

Beim Aktivieren der MFA werden Wiederherstellungscodes erzeugt – bewahren Sie sie sicher auf. Sie werden sofort gehasht und lassen sich nicht erneut abrufen.

### AgentHost-API-Schlüssel

BuilderForce Agents-Instanzen verwenden keine JWTs. Jeder registrierte AgentHost erhält bei der Registrierung einen **einmalig angezeigten API-Schlüssel im Klartext**. Der Schlüssel wird sofort gehasht, der Klartext wird nie gespeichert – geht er verloren, erzeugen Sie einen neuen.

Der AgentHost sendet diesen Schlüssel bei jeder Anfrage per `Authorization: Bearer <key>`. Die API prüft ihn gegen den gespeicherten Hash und ermittelt den Mandantenkontext aus dem Registrierungsdatensatz des AgentHosts.

**Schlüssel tauchen niemals in URLs auf.** Früher war das in einigen Builderforce-Endpunkten ein Muster, das inzwischen migriert wurde – alle per AgentHost authentifizierten Endpunkte verwenden jetzt ausschließlich den `Authorization`-Header. So bleiben Schlüssel aus Server-Zugriffslogs und CDN-Caches heraus.

---

## Session-Verwaltung

Jede aktive Browser-Session wird in der Tabelle `auth_user_sessions` erfasst. Manager können im Sicherheitsbereich die Sessions jedes Benutzers in ihrem Mandanten einsehen und widerrufen.

Die Session-Ansicht zeigt:

| Feld | Wert |
|---|---|
| Session-ID | Eindeutige Kennung |
| User Agent | Browser und Betriebssystem |
| IP-Adresse | Zuletzt gesehene IP |
| Erstellt am | Startzeit der Session |
| Zuletzt aktiv | Letzte authentifizierte Anfrage |
| Status | Aktiv oder widerrufen |

Das Widerrufen einer Session macht alle innerhalb dieser Session ausgestellten Tokens ungültig. Der Benutzer wird bei seiner nächsten Anfrage abgemeldet.

---

## Vertrauen und Dispatch-Sicherheit bei BuilderForce Agents

Das AgentHost-Mesh bringt eine zusätzliche Vertrauensfläche mit sich: den Dispatch von AgentHost zu AgentHost. Wenn AgentHost A eine Aufgabe an AgentHost B sendet, muss AgentHost B prüfen, dass die Anfrage tatsächlich von AgentHost A stammt – und nicht von einem Angreifer, der den Endpunkt von AgentHost B entdeckt hat.

Builderforce verwendet für jeden Dispatch zwischen AgentHosts eine **HMAC-SHA256-Payload-Signatur**:

```
AgentHost A sends:
  POST /api/agent-hosts/:id/forward
  Authorization: Bearer <agentHostApiKey>
  X-AgentHost-Signature: sha256=<hmac>
  X-AgentHost-From: <sourceAgentHostId>
  Body: { task: "..." }
```

Der HMAC wird über den rohen Request-Body berechnet, mit dem API-Schlüssel des sendenden AgentHosts als Geheimnis. Der empfangende AgentHost (über `verifyAgentHostSignature` von Builderforce) berechnet den HMAC neu und vergleicht. Bei einer Abweichung wird `403` zurückgegeben, bevor der Payload verarbeitet wird.

Fehlt die Signatur, akzeptiert Builderforce die Anfrage aus Gründen der Abwärtskompatibilität – protokolliert das Fehlen aber. In einem künftigen Härtungs-Release wird eine fehlende Signatur bei weitergeleiteten Aufgaben zur harten Ablehnung führen.

---

## Das Audit-Log

Jede wesentliche Aktion in Builderforce wird im **Audit-Log** festgehalten – für Owner und Manager unter [/admin](/admin) zugänglich.

Das Audit-Log erfasst:

| Ereignistyp | Auslöser |
|---|---|
| `tenant.member_added` | Benutzer zum Mandanten hinzugefügt |
| `tenant.member_removed` | Benutzer aus dem Mandanten entfernt |
| `agentHost.registered` | Neue BuilderForce Agents-Instanz angelegt |
| `agentHost.status_changed` | AgentHost aktiviert, deaktiviert oder gesperrt |
| `approval.created` | Agent hat ein Freigabe-Gate angefordert |
| `approval.decided` | Manager hat genehmigt oder abgelehnt |
| `task.created` | Aufgabe auf dem Board angelegt |
| `execution.submitted` | Aufgabe zur Ausführung übergeben |
| `execution.state_changed` | Ausführung wechselte zu running/completed/failed |
| `project.created` | Neues Projekt angelegt |
| `skill.assigned` | Skill einem Mandanten oder AgentHost zugewiesen |

Jedes Ereignis hält fest: wer, was, wann, welche Ressource (Typ und ID) sowie strukturierte Metadaten.

### Tool-Audit-Ereignisse

Getrennt vom Audit-Log des Mandanten erfasst das **Tool-Audit-Log** jeden Tool-Aufruf eines BuilderForce Agents-Agents: den Tool-Namen, die Eingabeargumente, das Ergebnis, die Dauer und ob der Aufruf erfolgreich war oder fehlschlug. Dieses Log ist die maßgebliche Quelle für die Frage „Was hat der Agent tatsächlich getan?“ – nützlich beim Debugging und für Compliance-Prüfungen.

---

## Architektur der Datenisolation

Die Isolation zwischen Mandanten wird auf der Ebene der Datenbankabfragen durchgesetzt – nicht auf der Ebene der Anwendungslogik.

Jede Abfrage auf eine mandantenbezogene Tabelle enthält eine explizite `tenantId`-Bedingung:

```typescript
const rows = await db
  .select()
  .from(projects)
  .where(
    and(
      eq(projects.tenantId, tenantId),  // always present
      eq(projects.status, 'active'),
    )
  );
```

Es gibt keinen „alles auswählen“-Pfad, der den Mandantenfilter weglässt. Selbst wenn die Anwendungslogik einen Fehler hätte, würde die Abfrage keine Daten eines anderen Mandanten zurückgeben.

Auch BuilderForce Agents-Instanzen sind mandantenbezogen – ein bei Mandant A registrierter AgentHost kann keine Aufgaben aus dem Dispatch von Mandant B empfangen, erscheint nicht in der Flottenansicht von Mandant B und kann den Projektkontext von Mandant B nicht lesen.

---

## Datenschutzkontrollen

Builderforce unterstützt Anfragen nach DSGVO und CCPA. Benutzer können in ihren Kontoeinstellungen eine Anfrage auf Löschung oder Auskunft stellen, oder ein Manager kann sie in ihrem Namen einreichen.

Datenschutzanfragen durchlaufen einen formalen Workflow:

```
submitted → in_review → completed / closed
```

Alle mit der Anfrage verbundenen personenbezogenen Daten (Chatverlauf, Audit-Ereignisse, Nutzungs-Snapshots) können auf Anfrage gemäß der jeweils geltenden Vorschrift gelöscht werden.

---

## Sicherheit der Quellcodeverwaltung

Wenn Sie über die Source-Control-Integration ein GitHub- oder Bitbucket-Konto verbinden, speichert Builderforce ausschließlich:

- Die Kontokennung (Organisation/Benutzername)
- Die Host-URL (für selbst gehostetes GitHub Enterprise)
- Den Integrationstyp

In der Datenbank von Builderforce werden keine OAuth-Tokens oder PATs gespeichert. Die Token-Verwaltung übernimmt die BuilderForce Agents-Instanz, die die Git-Operationen ausführt.

---

## Sicherheits-Roadmap

Für Phase 2 und darüber hinaus sind mehrere Sicherheitserweiterungen geplant:

- **Verpflichtende HMAC-Signaturen** – unsignierten Dispatch zwischen AgentHosts ohne Übergangsfrist für Abwärtskompatibilität ablehnen
- **Gerätevertrauen** – vertrauenswürdige Geräte registrieren; bei neuen Geräten eine erneute Authentifizierung verlangen
- **IP-Allowlists** – den Zugriff auf einen Mandanten auf bestimmte CIDR-Bereiche beschränken
- **SSO** – SAML und OIDC für Enterprise-Identitätsanbieter
- **SIEM-Export** – Audit-Ereignisse per OTel an externe Logsysteme streamen

---

## Best Practices

**Rotieren Sie AgentHost-API-Schlüssel vierteljährlich.** Ein Schlüssel, der nie rotiert wurde, liegt womöglich seit Monaten in einer Shell-History-Datei. Registrieren Sie einen neuen Schlüssel, aktualisieren Sie die Umgebungsvariable des AgentHosts, starten Sie den AgentHost neu und widerrufen Sie den alten Schlüssel.

**Vergeben Sie die minimal nötige Rolle.** Developer brauchen keinen `MANAGER`-Zugriff. Reviewer brauchen keinen `DEVELOPER`-Zugriff. Die Rollenzuweisung sollte der tatsächlichen Verantwortung entsprechen.

**Aktivieren Sie MFA für alle Manager und Owner.** Developer-Konten mit Lese- und Schreibzugriff sind lohnende Ziele; Manager-Konten, die destruktive Aktionen genehmigen können, sind es noch mehr.

**Prüfen Sie nach jedem unerwarteten Agent-Verhalten das Tool-Audit-Log.** Bevor Sie einen Workflow erneut ausführen, der ein überraschendes Ergebnis geliefert hat, lesen Sie nach, was der Agent tatsächlich getan hat – das Tool-Audit-Log ist die maßgebliche Aufzeichnung.

---

## Nächste Schritte

- Überprüfen Sie die Rollenzuweisungen Ihres Teams unter [Einstellungen → Mitglieder](/settings)
- Aktivieren Sie MFA unter [Einstellungen → Sicherheit](/security)
- Sehen Sie im [Audit-Log](/admin) nach aktuellen wesentlichen Ereignissen in Ihrem Mandanten
- Lesen Sie [Freigabe-Gates und menschliche Aufsicht](/blog/approval-gates-and-human-oversight) zu den Human-in-the-Loop-Kontrollen, die die Plattformsicherheit ergänzen
