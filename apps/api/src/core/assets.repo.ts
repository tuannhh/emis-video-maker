import { Inject, Injectable } from '@nestjs/common';
import type { Asset, AssetKind } from '@edu/shared';
import { DbService } from './db.service.js';

function toAsset(r: any): Asset {
  return {
    id: r.id,
    kind: r.kind,
    key: r.key,
    name: r.name,
    description: r.description,
    files: r.files,
    meta: r.meta,
    createdAt: r.created_at.toISOString(),
  };
}

@Injectable()
export class AssetsRepo {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  async list(kind?: AssetKind): Promise<Asset[]> {
    const rows = kind
      ? await this.db.query('select * from assets where kind = $1 order by created_at', [kind])
      : await this.db.query('select * from assets order by kind, created_at');
    return rows.map(toAsset);
  }

  async get(kind: AssetKind, key: string): Promise<Asset | null> {
    const row = await this.db.one('select * from assets where kind = $1 and key = $2', [kind, key]);
    return row ? toAsset(row) : null;
  }

  async getById(id: string): Promise<Asset | null> {
    const row = await this.db.one('select * from assets where id = $1', [id]);
    return row ? toAsset(row) : null;
  }

  async upsert(a: Pick<Asset, 'kind' | 'key' | 'name' | 'description' | 'files' | 'meta'>): Promise<Asset> {
    const row = await this.db.one(
      `insert into assets (kind, key, name, description, files, meta)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (kind, key) do update
         set name = excluded.name, description = excluded.description,
             files = excluded.files, meta = excluded.meta
       returning *`,
      [a.kind, a.key, a.name, a.description, JSON.stringify(a.files), JSON.stringify(a.meta)],
    );
    return toAsset(row);
  }

  async updateMeta(id: string, meta: Asset['meta']) {
    await this.db.query('update assets set meta = $2 where id = $1', [id, JSON.stringify(meta)]);
  }

  async delete(id: string) {
    await this.db.query('delete from assets where id = $1', [id]);
  }
}
