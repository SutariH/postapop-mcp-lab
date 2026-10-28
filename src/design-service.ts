// Sketchpad is a made-up design service. The product connects to it with
// ITS OWN connection (in a real product: an OAuth connection the person made
// in the product's settings). The MCP tool never downloads anything itself.

export interface Design {
  id: string;
  title: string;
  kind: 'image' | 'video';
  pageCount: number;
  /** When the design last changed. A new export is needed only after this time. */
  updatedAt: string;
}

/** One exported page, already copied into the product's own media library. */
export interface ExportedPicture {
  mediaId: string;
  page: number;
}

export interface DesignService {
  getDesign(designId: string): Promise<Design>;
  /** The expensive step: slow, and counted against the account's export quota. */
  exportPages(designId: string, pages: number[]): Promise<ExportedPicture[]>;
}

/** An HTTP-style failure from the design service. The status decides what we tell the person. */
export class DesignServiceError extends Error {
  constructor(readonly status: number) {
    super(`Sketchpad answered ${status}.`);
    this.name = 'DesignServiceError';
  }
}

interface MockDesign extends Design {
  /** The Sketchpad account that owns the design. Only the connected account can read it. */
  owner: string;
}

interface MockDesignServiceOptions {
  designs: MockDesign[];
  connectedAccount: string;
  /** For tests: runs before each export, for example to wait or to change the post meanwhile. */
  beforeExport?: (designId: string) => Promise<void> | void;
}

export function createMockDesignService({ designs, connectedAccount, beforeExport }: MockDesignServiceOptions) {
  let nextMedia = 1;
  const exports: string[] = [];

  function find(designId: string) {
    const design = designs.find((candidate) => candidate.id === designId);
    if (!design) throw new DesignServiceError(404);
    if (design.owner !== connectedAccount) throw new DesignServiceError(403);
    return design;
  }

  const service: DesignService & { exports: string[] } = {
    /** Every export, for tests: an unchanged design must not appear here twice. */
    exports,

    async getDesign(designId) {
      const { owner: _owner, ...design } = find(designId);
      return design;
    },

    async exportPages(designId, pages) {
      find(designId);
      await beforeExport?.(designId);
      exports.push(designId);
      return pages.map((page) => ({ mediaId: `media_${String(nextMedia++).padStart(3, '0')}`, page }));
    },
  };
  return service;
}
