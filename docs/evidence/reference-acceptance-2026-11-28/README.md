# Issue #3 collector implementation validation

These are local **Linux** measurements, not reference-Windows or consuming-service
acceptance. Node 24.22.3 / Python 3.12.14 / Git 2.56.1; shared executor background
load was uncontrolled. The report records before/after load and machine details.

The performance collector ran three latency/capacity samples and one complete
staged build against the verified published Harness 0.13.0. All **182 host tests
and 11 adapter conformance cases passed, with no skips**. The full staged suite
including setup took **128.606 seconds**. Capacity regeneration was **1249 / 1368 /
1223 ms**. Exact 64 MiB acceptance and over-limit refusal passed. These Linux
results do not supersede the historical hosted-Windows RM-6 target misses.

The extracted, integrity-checked candidate also ran the collector's service mode
under the local Linux account. This is a process simulation, not Windows/IIS
acceptance. The wrong-account simulation refused before any service phase or
runtime creation. All 20 performance-bundle and three service-bundle file hashes
were checked locally.

`summary.json` retains candidate/archive identities and the exact tested collector,
regression-test and SudoLang-specification hashes. `report.json`, `latency.json`,
`capacity.json`, `test-timing-linux.json` and the two service reports are unedited
JSON selected from those runs. `SHA256.json` inventories this retained JSON subset,
excluding itself. Full TAP/phase logs and the generated archive were reviewed
locally; this directory is explicitly a subset, not the original full bundle.

The candidate did not contain this subsequently added evidence directory. The
collector implementation/tests/specification are byte-identical to the tested
candidate. New CI qualifies the final PR tree. Follow
[the operator runbook](../../ISSUE_3_ACCEPTANCE.md) on the actual Windows machines;
issue #3 remains open until that evidence and any unmet targets are reviewed.
