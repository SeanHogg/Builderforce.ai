# Dependencies

Generated from the `dependencies:` fields of the program files and checked by `scripts/check-roadmap-entries.mjs` (every id exists, no cycles). Only edges the strategy states or implies are listed; an entry absent here has no stated prerequisite.

| Entry | Needs |
|---|---|
| `WC-02` | `WC-01` |
| `WC-03` | `WC-02` |
| `WC-04` | `WC-02`, `WC-03` |
| `WC-05` | `WC-04` |
| `WC-06` | `WC-05`, `SEC-03` |
| `WC-07` | `WC-02` |
| `WC-09` | `WC-04` |
| `WC-11` | `WC-04` |
| `WC-12` | `WC-02` |
| `WC-13` | `WC-12` |
| `WC-15` | `WC-04` |
| `WC-18` | `WC-12` |
| `AE-02` | `AE-01` |
| `AE-03` | `AE-02` |
| `AE-04` | `AE-01` |
| `AE-05` | `AE-02` |
| `AE-06` | `WC-02`, `SEC-03`, `REL-03` |
| `AE-07` | `AE-03` |
| `AE-08` | `AE-07` |
| `AE-09` | `AE-03` |
| `AE-10` | `AE-07`, `AE-09` |
| `AE-11` | `AE-03` |
| `AE-12` | `AE-05`, `WC-13` |
| `AE-14` | `AVR-04` |
| `AE-19` | `AE-08` |
| `AE-20` | `AE-10` |
| `AE-21` | `AE-06` |
| `AVR-02` | `AVR-01` |
| `AVR-03` | `AVR-01` |
| `AVR-04` | `AVR-03` |
| `AVR-06` | `AVR-04` |
| `AVR-07` | `AVR-04` |
| `AVR-08` | `MEM-02` |
| `AVR-09` | `WC-13` |
| `AVR-10` | `AVR-04`, `SEC-08` |
| `AVR-11` | `AVR-10` |
| `SEC-02` | `SEC-01` |
| `SEC-03` | `SEC-01` |
| `SEC-04` | `WC-02`, `SEC-03` |
| `SEC-08` | `AVR-06` |
| `SEC-10` | `SEC-05` |
| `SEC-13` | `SEC-03` |
| `REL-02` | `REL-01` |
| `REL-03` | `REL-01` |
| `REL-04` | `REL-01` |
| `REL-05` | `REL-01` |
| `REL-06` | `REL-04` |
| `REL-11` | `REL-03` |
| `REL-12` | `REL-03` |
| `REL-16` | `REL-01` |
| `HOST-02` | `WC-06`, `SEC-03` |
| `HOST-03` | `HOST-01` |
| `HOST-06` | `HOST-03`, `WC-13` |
| `AI-02` | `AI-01` |
| `MEM-02` | `MEM-01` |
| `COM-02` | `AE-11` |
| `COM-03` | `COM-02` |
