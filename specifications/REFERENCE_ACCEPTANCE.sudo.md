# Reference acceptance collector — issue #3

```sudolang
ReferenceAcceptance {
  inputs: command(performance | service), verifiedHarness, freshOutputDirectory,
    context, machineLabel, loadNote, samples(1..20, default 5),
    suiteRepeat(1..3, default 1), expectedIdentity?, launchContext?
  constraints {
    reject unknown, duplicate, missing or invalid arguments
    reference-workstation and target-server require Windows and no detected CI
    command chooses permitted contexts; never infer a reference machine from CI
    reference-workstation requires at least three timing samples
    output must be fresh and outside both packages after resolving parent links
    never accept a production runtime; never edit package or existing runtime
    verify host release integrity or hash Git source inputs including uncommitted files
    verify approved Harness manifest and payload; performance uses published reference pair
    compare host source/release and Harness identities after measurement; refuse drift
    preserve failed measurements, phase exits and all raw samples
    use owned child supervision with existing operation/scenario/suite deadlines
    no shell interpolation; never invoke inference, a scheduler or an HTTP endpoint
  }
  record {
    timestamps, declared context/label/load, OS edition/build on Windows,
    CPU/memory, tool versions, OS process identity, CI indication, package digests,
    before/after memory/load/CPU-time snapshots, per-phase elapsed/exit/error/logs
    Windows load average is null (unsupported), never invented zero load
  }
  performance {
    run benchmark-host(samples): retain startup, submit10, askWithRetrieval, status,
      raw elapsed, indexer/validator exclusions and retained retrieval cost
    run benchmark-capacity(samples): retain actual Harness limits, subjects10000,
      turns100000, regeneration, deep refresh, validator/statistics, 64MiBBoundaries
    repeat suiteRepeat: build-release in separate build-N evidence directory
    continue after phase failure; missing/failing build timing remains incomplete
    summarize using all raw samples and strict under-target comparison:
      submit<2000ms; ask<3000ms; status<1000ms; regeneration<3000ms;
      fullStagedBuildIncludingSetup<600000ms
    never turn a median or later successful attempt into all-sample acceptance
    startup is measured without inventing a target
  }
  service {
    require extracted verified host release, expectedIdentity and launchContext
    resolve Windows name/SID with OS whoami (never USERNAME/USERDOMAIN)
    refuse mismatch before creating a disposable runtime
    run existing service-probe using temporary synthetic settings/runtime
    retain actual identity, declared launch context, result and package digests
    matching identity proves account, not that consuming service launched it
    no change to IIS/pool/production ACLs; no HTTPS/ARR or provider-mode claim
    clean only collector-owned scratch after children terminate
  }
  finalize {
    preserve partial report on failure, explicit errors and cleanup failures
    complete requires requested measurements and successful phases
    target miss != incomplete execution; retain unmet target names
    inventory report/logs/build files with SHA256.json excluding itself
    exit 0 only when complete; never auto-close issue from measurements
  }
}
```

Canonical implementation: tools/reference-acceptance.mjs. Operator workflow:
docs/ISSUE_3_ACCEPTANCE.md. Behavioral checks: tests/reference-acceptance.test.mjs.
