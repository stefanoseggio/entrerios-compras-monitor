# Changelog

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
