import { Controller, Get, Inject, NotFoundException, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { StorageService } from '../core/storage.service.js';

@Controller()
export class FilesController {
  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  @Get('api/health')
  health() {
    return { ok: true };
  }

  /** Phục vụ file (hỗ trợ Range để tua video). ?download=ten-file.mp4 để tải về. */
  @Get('files/*path')
  async file(@Param('path') segments: string | string[], @Query('download') download: string | undefined, @Res() res: Response) {
    const key = (Array.isArray(segments) ? segments.join('/') : segments).replace(/^\/+/, '');
    let full: string;
    try {
      full = this.storage.resolve(key);
    } catch {
      throw new NotFoundException();
    }
    if (!(await this.storage.exists(key))) throw new NotFoundException();
    if (download) res.attachment(download);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.sendFile(full, { maxAge: key.startsWith('lessons/') ? 0 : '1h' });
  }
}
