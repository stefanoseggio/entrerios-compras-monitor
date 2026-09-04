/** Raw filter values as accepted by the actor input and by the site's own POST form. */
export type EstadoCode = '' | '1' | '2' | '3' | '4';
export type TipoLicitacionCode = '' | '1' | '2' | '3' | '4';
export type OrganismoCode = '' | '1' | '3' | '4' | '5' | '6' | '7' | '8' | '9';

export interface ActorInput {
    estado?: EstadoCode;
    tipoLicitacion?: TipoLicitacionCode;
    anio?: string;
    organismo?: OrganismoCode;
    palabra?: string;
    maxItems?: number;
}

/** One row of the results table (`#tabla-resultados`), normalized. */
export interface TenderRecord {
    /** Stable id derived from the 4 content fields (the site has no native row id). */
    id: string;
    /** Raw "Procedimiento de Contratación" cell, e.g. "Solicitud De Cotizacion 54/2025". Kept as free text - see AGENTS.md for why it is not split into tipo/numero/anio. */
    procedimiento: string;
    /** Trailing year extracted from `procedimiento` (last `/NNNN` segment), or null if the row didn't match that pattern. */
    anioProcedimiento: string | null;
    objeto: string;
    destino: string;
    organismo: string;
    /** Normalized status label - see AGENTS.md for the source-side encoding corruption this corrects. */
    estado: string;
    scrapedAt: string;
}
