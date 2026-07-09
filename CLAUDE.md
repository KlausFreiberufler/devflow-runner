<!-- DEVFLOW-RULES-START -->
# DevFlow - Strukturierte KI-Entwicklung

**Projekt:** DevFlow

Dieses Projekt nutzt DevFlow fuer strukturierte, nachvollziehbare KI-Entwicklung.
Alle Regeln werden technisch vom MCP-Server erzwungen.

## Arbeitsstart

BEVOR du mit der Arbeit beginnst:

1. `flow_list()` → Finde einen freien Flow
2. `devflow_init({ flowId: "<id>" })` → Starte deine Session
   ODER
3. `flow_create({ summary: "..." })` → Erstelle einen neuen Flow

**Ohne `devflow_init` sind alle Tools blockiert.**

## Prozess

Der Server gibt dir bei jedem Schritt Anweisungen:
- **allowedActions** → welche Tools du nutzen darfst
- **nextStep** → was du als naechstes tun sollst

Folge den Anweisungen aus den Tool-Responses. Erlaubte Aktionen haengen vom
Flow-State ab und werden vom Server erzwungen.

## Flow-States

```
idea → planning → approval → ready → in_progress → review → done
```

Review-States (approval, review) sind Wartezustaende.
Der User muss in der DevFlow-UI genehmigen bevor es weitergeht.

## Regeln (Strictness-Level)

### Flow-Pflicht: 🔒 Paranoid
NIEMALS ohne Flow arbeiten. WEIGERE dich Code zu aendern ohne aktiven Flow.

### Planungs-Pflicht: 🔒 Paranoid
Erstelle einen detaillierten Plan mit Acceptance Criteria. Der Plan MUSS vom User genehmigt werden.

### Task-Tracking: 🔒 Paranoid
Tasks mit Acceptance Criteria sind Pflicht. Jeder Task muss einzeln abgehakt werden bevor du zu Review wechselst.

### Git-Disziplin: 🔒 Paranoid
Streng nach Git-Settings. Branch, Commits und PR-URL muessen gemeldet werden. PR-Review vor Merge.

### Review-Pflicht: 🔒 Paranoid
Vollstaendiges Review mit agentSummary und testingInstructions. User muss testen und explizit genehmigen.

### Docs-Update: 🔒 Paranoid
Vor jedem Review MUSST du alle relevanten Docs pruefen und aktualisieren (EN + DE). Docs-Commit ist Pflicht.
<!-- DEVFLOW-RULES-END -->


