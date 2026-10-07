import { Controller, Get, Inject, NotFoundException, Param, Query, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { StorageService } from '../core/storage.service.js';
import { verifySignature } from '../core/secure.js';
import { Public, type AuthedRequest } from './auth.guard.js';

@Controller()
export class FilesController {
  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  @Public()
  @Get('api/health')
  health() {
    return { ok: true };
  }

  /**
   * Phục vụ file (hỗ trợ Range để tua video). ?download=ten-file.mp4 để tải về.
   * Cần đăng nhập, hoặc chữ ký ?t= của link nội bộ (renderer). Khi lưu trên GCS thì chuyển sang link ký sẵn.
   */
  @Public()
  @Get('files/*path')
  async file(
    @Param('path') segments: string | string[],
    @Query('download') download: string | undefined,
    @Query('t') token: string | undefined,
    @Req() req: AuthedRequest,
    @Res() res: Response,
  ) {
    const key = (Array.isArray(segments) ? segments.join('/') : segments).replace(/^\/+/, '');
    const internal = !!token && verifySignature('file', key, token);
    if (!internal && !req.user) throw new UnauthorizedException('Vui lòng đăng nhập');
    let full: string;
    try {
      full = this.storage.resolve(key);
    } catch {
      throw new NotFoundException();
    }
    if (!(await this.storage.exists(key))) throw new NotFoundException();
    const signed = internal ? null : await this.storage.signedUrl(key, download);
    if (signed) {
      res.setHeader('Cache-Control', 'private, max-age=600');
      return res.redirect(302, signed);
    }
    if (download) res.attachment(download);
    res.setHeader('Cache-Control', key.startsWith('lessons/') ? 'private, no-cache' : 'private, max-age=3600');
    res.sendFile(full, { cacheControl: false });
  }
}
