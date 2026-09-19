# Changelog

## [3.0.0](https://github.com/stefanoseggio/entrerios-compras-monitor/compare/entrerios-compras-monitor-v2.0.0...entrerios-compras-monitor-v3.0.0) (2026-09-19)


### ⚠ BREAKING CHANGES

* v2.0 delta engine - STATUS_CHANGE/CLOSED, no fake UPDATED

### Features

* v2.0 delta engine - STATUS_CHANGE/CLOSED, no fake UPDATED ([a7ebca6](https://github.com/stefanoseggio/entrerios-compras-monitor/commit/a7ebca64309a9a36b99a3d8864fab213c201b0f2))


### Bug Fixes

* bump transitive adm-zip to 0.6.1, resolving a HIGH-severity CVE ([#11](https://github.com/stefanoseggio/entrerios-compras-monitor/issues/11)) ([eb98f6f](https://github.com/stefanoseggio/entrerios-compras-monitor/commit/eb98f6f4a0cb46441a282d60156b552cccfefd10))
* **ci:** pass RELEASE_PLEASE_TOKEN so release PRs skip the bot-approval gate ([7a9bdb1](https://github.com/stefanoseggio/entrerios-compras-monitor/commit/7a9bdb183e7a68bd98f2de6ea5da5ff63eef554f))
* **delta:** guard CLOSED detection against a fetch that only looks empty ([#8](https://github.com/stefanoseggio/entrerios-compras-monitor/issues/8)) ([1f8d1e6](https://github.com/stefanoseggio/entrerios-compras-monitor/commit/1f8d1e6a5d4530c44dd39b4ae901d46a9b559579))
* gate CLOSED detection on an unfiltered run - real false positive caught in cloud verification ([8507047](https://github.com/stefanoseggio/entrerios-compras-monitor/commit/850704716dcf3f704bc10f270e313e0f166edb31))
* **http:** add per-attempt timeout and scope retries to transient errors ([#9](https://github.com/stefanoseggio/entrerios-compras-monitor/issues/9)) ([7b558ba](https://github.com/stefanoseggio/entrerios-compras-monitor/commit/7b558ba48d5c64fd4497b81bbfb91e79474c5ad8))
* **main:** add top-level try/catch + LAST_ERROR around run(); document record_id text-fragility risk ([#10](https://github.com/stefanoseggio/entrerios-compras-monitor/issues/10)) ([9f69ec0](https://github.com/stefanoseggio/entrerios-compras-monitor/commit/9f69ec0afd32f20a86da3cdcfeb3cfa01b35fa7b))
* **readme:** correct stale source_url in example output ([7356962](https://github.com/stefanoseggio/entrerios-compras-monitor/commit/73569626cb76d42b11e7a30886daccbe429cdeec))

## 2.0.0 - 2026-09-08

The v2 delta engine: real status-change and closure detection, replacing the v1 retrofit's "always NEW_LISTING" limitation - see AGENTS.md "Delta engine v2" for the full technical reasoning.

### Added

- **`STATUS_CHANGE` events**: a tender whose `estado` changed since it was last seen (e.g. "En proceso de Evaluación" -> "Realizada") is now reported as `STATUS_CHANGE` with `previousEstado` set - free to detect, `estado` is already in the fetched row.
- **`CLOSED` events**: a tender no longer present in the register is now detected and reported, instead of silently disappearing. Only computed on an UNFILTERED run (no estado/tipoLicitacion/organismo/anio/palabra set) - a filtered run's fetch is a subset of the register, not the whole thing, so CLOSED is skipped (and logged) otherwise. This gate was added after cloud verification caught a real false-positive: a filtered follow-up run wrongly reported 37 records outside its filter as CLOSED before the fix.
- **`eventTypes` input**: narrows delta-mode delivery to a subset of `NEW_LISTING`/`STATUS_CHANGE`/`CLOSED`.
- `previousEstado` output field; a second dataset view ("Status changes & closures").
- Apache-2.0 `LICENSE`, this `CHANGELOG.md`, an `npx eslint .` step in CI.

### Changed

- **Delta state shape**: `src/state.ts` replaced the v1 bare `seenIds: string[]` with `entries: Record<record_id, {estado}>` - needed for STATUS_CHANGE. **Not backward compatible**: a v1-shaped state is treated as absent, not migrated - an existing scheduled task's next run re-baselines.
- **Deliberately no `UPDATED` event, by design not oversight**: `record_id` is itself a hash of procedimiento+objeto+destino+organismo, so any change to those fields produces a genuinely different id - indistinguishable from a new listing without a real source-issued id to correlate old and new rows. `estado` is the only field this source can ever say "the same record changed" about. See AGENTS.md.

### Fixed

- Production `start` script pointed at `start:dev` (`tsx`), which Apify's production image cannot run (`npm install --only=prod` strips `tsx`). Switched to the prebuilt `dist/main.js` and stopped gitignoring `dist/` so the build actually ships.
