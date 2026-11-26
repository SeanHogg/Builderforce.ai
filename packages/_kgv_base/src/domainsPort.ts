/**
 * The Domains drawer's port types: the host's proposed folder layout for one folder, restated here so this package
 * stays free of the host's. The host (not the view) computes the layout, applies the accepted domains and undoes them.
 */

export type DomainReason = 'existing-folder' | 'name' | 'test-subject' | 'imports';

export interface DomainMove { from: string; to: string; domain: string; reason: DomainReason }
/** `files` are the paths after the move. */
export interface DomainGroup { id: string; isNew: boolean; files: string[] }

export interface DomainLayout {
    folder: string;
    domains: DomainGroup[];
    moves: DomainMove[];
    unassigned: string[];
    conflicts: { from: string; to: string }[];
    /** File links crossing domains inside the folder: as it is, and as it would be. */
    crossEdges: { before: number; after: number };
}
