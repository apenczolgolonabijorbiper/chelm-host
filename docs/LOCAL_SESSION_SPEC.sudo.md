# LocalSessionContract(version = 1)

Implement(targetLanguage, platform) {
  preserve docs/LOCAL_SESSIONS.md LCS-1..LCS-7;
  use exact supported packages; Git remains required;
  keep appSource, runtime, packages, privateStore separate;
  forbid copied Harness validators, graph editing as an agent protocol,
    model server, scheduler, GitHub runtime requirement, mandatory MCP;

  CreateCheckpoint {
    acquire normal host operation mutex;
    require contained canonical roots, clean Git index and unchanged committed bytes;
    refuse processing leases (including expired), nonterminal assignments,
      unresolved adoption/cutover/publication/learning, linked or unknown content;
    inventory exact instance + host tasks/results/receipts + citation bytes;
    replace task ownership by @restore-owner; remove live worker authorization;
    pack all allowlisted local refs/history; bound expanded objects before Git import;
    bind exact package identities; hash each component and envelope;
    optionally bind durable generation/base_revision, never credentials;
    publish immutable complete output exclusively; preserve existing checkpoint;
  }
  RestoreCheckpoint {
    require fresh nonexistent owned root, trusted digest, explicit local apply;
    validate manifest/version/packages/paths/budgets/base64/hashes/bundle/history;
    reconstruct Git without remotes/hooks/helpers/config; never execute saved bindings;
    bind current OS task owner and trusted local executables/profile source;
    validate through public Harness and provider audit; verify citation bytes;
    regenerate views in private stage; atomically activate; grant no publishing authority;
  }
  DurablePublication {
    require authenticated app-owned runtime/principal and exact package binding;
    persist input/evidence before local work; use stable IDs and independent durable queue;
    acquire one expiring owner session bound to generation + monotonic fence + exact base;
    register every upload attempt before immutable write;
    verify immutable bytes, manifest, package identity and generation/base;
    CAS transaction {
      enforce owner/session/fence/expiry/generation/base at the actual head selection;
      deduplicate original submission ID/metadata;
      select head + projection + only explicitly covered request acknowledgements;
      preserve original receipt; increment revision exactly once;
    }
    on unknown upload/head response => retain checkpoint-pending and recover same ID;
    on lost workspace => restore selected head; replay pending inputs idempotently;
    on unavailable store => refuse, never publish unfenced or report saved;
  }
  Reset {
    atomic { revoke session; increment fence/generation; inventory all keys/attempts;
      clear authoritative head/queue/results/projection/receipts; }
    reject every old generation result/renewal/import/publication;
    prune all controlled object versions/staging; retain unknown-write tombstones;
    erase reachable owned local copies; report detached copies pending-unreachable;
    never equate timeout/404 with conclusive upload settlement;
  }
  Acceptance {
    run tests/checkpoint.test.mjs, tests/durable-session.test.mjs,
      tests/session-transport.test.mjs plus full staged package checks;
    separately observe real model inference, hosted storage/authenticated transport,
      fresh agent session resume and Windows/Linux/macOS setup;
    pending external observations remain pending; deterministic fixtures are not model evidence;
  }
}

Maintenance {
  when reference code/API/bounds/pins change => update this specification,
    lifecycle prompts, docs, fixtures, schema and release claims together;
  generated target-language implementations must pass equivalent conformance;
  this specification does not certify an untested generated implementation;
}
