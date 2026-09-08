/**
 * The search form's POST target. Also reused as `source_url` on every pushed
 * record: the site publishes NO per-tender detail page or link anywhere in
 * `#tabla-resultados` (zero `<a href>` inside the table - verified live, see
 * AGENTS.md), so there is no real deep link to give a consumer. This shared
 * listing URL is the closest honest answer - re-querying it (optionally with
 * the same filters this run used) is how a human would find the record on
 * the official site. It is NOT a unique per-record URL; every row from a
 * given run shares this exact string.
 */
export const TARGET_URL = 'https://www.entrerios.gov.ar/contrataciones/licitaciones.php';
//# sourceMappingURL=constants.js.map