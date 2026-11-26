# Optional cognizer-routing-v1 readiness

Discover host version.capabilities and chelm_routing_status before claiming scoped
work. Disabled/absent routing preserves the existing worker contract; no default
Shem installation is assumed.

Call chelm_routing_status {}. Use the binding provisioned for your authenticated
principal; executor metadata cannot select a cognizer. If unregistered, report
the refusal rather than retry with another declared identity. Register only
contracts/capabilities this client actually implements, with the exact selected
Harness manifest digest returned by status, using chelm_routing_register.
Renew readiness with chelm_routing_heartbeat {} while ready. Registration is a
trusted declaration, not evidence of binary identity or reasoning quality.

On deferred, retain pending work and honor retry_after_seconds; on busy, respect
existing quota/lease limits. On unknown claim/submit outcome, retry the original
request/submission ID and reconcile status/receipt before requesting new work.
A routing switch does not transfer existing ownership. See docs/COGNIZER_ROUTING.md.
