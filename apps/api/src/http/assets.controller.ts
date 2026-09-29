import { Controller, Delete, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe } from '@nestjs/common';
import { AssetsRepo } from '../core/assets.repo.js';
import { StorageService } from '../core/storage.service.js';

@Controller('api/assets')
export class AssetsController {
  constructor(
    @Inject(AssetsRepo) private readonly repo: AssetsRepo,
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}

  @Get()
  async list() {
    const assets = await this.repo.list();
    return assets.map((a) => ({
      ...a,
      urls: Object.fromEntries(Object.entries(a.files).map(([k, v]) => [k, this.storage.publicUrl(v)])),
    }));
  }

  /** Xoá khỏi thư viện: lần sản xuất sau AI sẽ vẽ lại tài sản này. */
  @Delete(':id')
  @HttpCode(204)
  async delete(@Param('id', ParseUUIDPipe) id: string) {
    const asset = await this.repo.getById(id);
    if (!asset) throw new NotFoundException('Không tìm thấy tài sản');
    await this.repo.delete(id);
  }
}
