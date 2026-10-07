import { Inject, Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import { z } from 'zod';
import type { Asset, Box, LessonScript, ScriptCharacter, Storyboard, StoryboardBackground } from '@edu/shared';
import { AssetsRepo } from '../core/assets.repo.js';
import { GeminiService } from '../core/gemini.service.js';
import { StorageService } from '../core/storage.service.js';
import { cutoutVariants } from './chroma.js';
import { composeRig } from './rig.js';
import {
  MOUTH_OPEN_PROMPT,
  POSE_EDITS,
  TURN_PROMPT,
  backgroundPrompt,
  backgroundVariantPrompt,
  characterPrompt,
  locateInstancesPrompt,
  locatePrompt,
  verifyBackgroundPrompt,
} from './prompts.js';
import { mapLimit, type Progress } from './util.js';

const BoxSchema = z.array(z.number()).length(4);
const LocateSchema = z.object({ objects: z.array(z.object({ label: z.string(), box_2d: BoxSchema })) });
const InstancesSchema = z.object({ items: z.array(z.object({ box_2d: BoxSchema })) });
const VerifySchema = z.object({ matches: z.boolean(), problems: z.array(z.string()) });

/** Phiên bản bộ dáng nhân vật; nhân vật cũ trong thư viện được vẽ lại (giữ nguyên thiết kế) khi khác */
export const RIG_VERSION = 3;
/** Dáng tay vẽ bằng cách sửa ảnh đứng; ghép lên ảnh đứng nên đầu/thân giữ nguyên */
const GESTURES = ['talk', 'explain', 'idea', 'point', 'cheer'] as const;
/** Ảnh gốc cần cho một bộ dáng (cùng khung cắt) */
const RIG_SOURCES = ['idle', 'idleOpen', 'blink', ...GESTURES] as const;
type RigSource = (typeof RIG_SOURCES)[number];

/** Ảnh tham chiếu phong cách của bài: gửi kèm khi vẽ nhân vật, bối cảnh MỚI */
export interface StyleRef {
  image: Buffer;
  mime: string;
  tag: string;
}

export interface ProducedAssets {
  characters: Record<string, Asset>;
  backgrounds: Record<string, Asset>;
  /** Vấn đề AI kiểm tra vẫn thấy sau mọi lần vẽ, báo cho người duyệt */
  warnings: string[];
}

function toBox(b: number[]): Box | null {
  const [ymin, xmin, ymax, xmax] = b.map((v) => Math.min(1, Math.max(0, v / 1000)));
  return ymax > ymin && xmax > xmin ? [ymin, xmin, ymax, xmax] : null;
}

@Injectable()
export class AssetsStep {
  private readonly logger = new Logger(AssetsStep.name);

  constructor(
    @Inject(GeminiService) private readonly gemini: GeminiService,
    @Inject(AssetsRepo) private readonly repo: AssetsRepo,
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}

  async run(script: LessonScript, board: Storyboard, progress: Progress, style: StyleRef | null = null): Promise<ProducedAssets> {
    const visual = script.characters.filter((c) => c.role !== 'narrator');
    const total = visual.length + board.backgrounds.length;
    let done = 0;
    const tick = async (msg: string) => {
      done++;
      await progress(Math.round((done / Math.max(1, total)) * 100), msg);
    };

    // Vật cần đếm từng cái (overlay count), theo nền
    const countTargets = new Map<string, Set<string>>();
    for (const scene of board.scenes) {
      for (const shot of scene.shots) {
        if (shot.overlay?.kind !== 'count') continue;
        const set = countTargets.get(scene.backgroundKey) ?? new Set<string>();
        set.add(shot.overlay.target);
        countTargets.set(scene.backgroundKey, set);
      }
    }

    const characters: Record<string, Asset> = {};
    const backgrounds: Record<string, Asset> = {};
    const warnings: string[] = [];
    const specs = new Map(board.backgrounds.map((b) => [b.key, b]));
    // Nền gốc vẽ trước, nền biến thể sửa từ nền gốc sau
    const isVariant = (b: StoryboardBackground) => !!b.variantOf && b.variantOf !== b.key;
    const bases = board.backgrounds.filter((b) => !isVariant(b));
    const variants = board.backgrounds.filter(isVariant);

    await Promise.all([
      mapLimit(visual, 2, async (c) => {
        characters[c.id] = await this.character(c, style);
        await tick(`Nhân vật ${c.name} đã sẵn sàng`);
      }),
      (async () => {
        await mapLimit(bases, 2, async (b) => {
          backgrounds[b.key] = await this.background(b, null, countTargets.get(b.key), warnings, style);
          await tick(`Bối cảnh ${b.key} đã sẵn sàng`);
        });
        await mapLimit(variants, 2, async (b) => {
          const base = backgrounds[b.variantOf!] ?? (await this.baseFor(b.variantOf!, specs, warnings, style));
          backgrounds[b.key] = await this.background(b, base, countTargets.get(b.key), warnings, style);
          await tick(`Bối cảnh ${b.key} đã sẵn sàng`);
        });
      })(),
    ]);
    return { characters, backgrounds, warnings };
  }

  /** Nền gốc của một biến thể không nằm trong storyboard: lấy trong thư viện */
  private async baseFor(
    key: string,
    specs: Map<string, StoryboardBackground>,
    warnings: string[],
    style: StyleRef | null,
  ): Promise<Asset | null> {
    const lib = await this.repo.get('background', key);
    if (lib) return lib;
    const spec = specs.get(key);
    return spec ? this.background(spec, null, undefined, warnings, style) : null;
  }

  // -------------------------------------------------------------------------
  // Nhân vật: ảnh đứng + 5 dáng tay (ghép chung một cái đầu) + miếng dán miệng mở / mắt nhắm
  // -------------------------------------------------------------------------
  private async character(c: ScriptCharacter, style: StyleRef | null): Promise<Asset> {
    const existing = await this.repo.get('character', c.id);
    if (existing?.meta.rig === RIG_VERSION) return existing;

    const png = (b: Buffer) => sharp(b).png().toBuffer();
    const opts = (images?: Buffer[]) => ({ aspectRatio: '3:4', images });
    const edit = async (label: string, prompt: string, from: Buffer) =>
      png(await this.gemini.image(`${label} ${c.name}`, prompt, opts([from])));
    const EDITS: Record<Exclude<RigSource, 'idle'>, [string, string]> = {
      idleOpen: ['Vẽ khẩu hình', MOUTH_OPEN_PROMPT],
      blink: ['Vẽ chớp mắt', POSE_EDITS.blink],
      talk: ['Vẽ dáng nói', POSE_EDITS.talk],
      explain: ['Vẽ dáng giải thích', POSE_EDITS.explain],
      idea: ['Vẽ dáng giơ ngón tay', POSE_EDITS.idea],
      point: ['Vẽ dáng chỉ tay', POSE_EDITS.point],
      cheer: ['Vẽ dáng reo mừng', POSE_EDITS.cheer],
    };

    // Dùng lại ảnh gốc đã vẽ của bộ dáng cũ (cùng thiết kế), chỉ vẽ thêm phần còn thiếu
    const sources: Partial<Record<RigSource, Buffer>> = {};
    if (existing?.meta.rig === 2) {
      // Bộ dáng 2 lưu ảnh gốc cạnh ảnh đã tách nền (source-<dáng>.png) nhưng không ghi vào files
      const dir = (existing.files.idle ?? existing.files.source ?? '').replace(/\/[^/]*$/, '');
      for (const k of RIG_SOURCES) {
        const key = existing.files[`source-${k}`] ?? (dir ? `${dir}/source-${k}.png` : undefined);
        if (key && (await this.storage.exists(key))) sources[k] = await this.storage.read(key);
      }
    }
    if (!sources.idle) {
      const oldSource = existing?.files.source ?? existing?.files.base;
      if (existing?.meta.ready && oldSource && (await this.storage.exists(oldSource))) {
        // Nhân vật tạo ở thư viện / mascot tải lên: ảnh gốc đã là dáng đứng trên nền magenta
        this.logger.log(`Dựng bộ dáng cho nhân vật thư viện: ${c.id}`);
        sources.idle = await png(await this.storage.read(oldSource));
      } else if (oldSource && (await this.storage.exists(oldSource))) {
        // Nhân vật cũ (vẽ chính diện): vẽ lại góc 3/4 từ ảnh cũ để giữ nguyên thiết kế
        this.logger.log(`Nâng cấp bộ dáng nhân vật: ${c.id}`);
        sources.idle = await png(
          await this.gemini.image(`Vẽ lại ${c.name} góc 3/4`, TURN_PROMPT, opts([await png(await this.storage.read(oldSource))])),
        );
      } else {
        this.logger.log(`Vẽ nhân vật mới: ${c.id}`);
        sources.idle = await png(
          await this.gemini.image(`Vẽ nhân vật ${c.name}`, characterPrompt(c.description, !!style), opts(style ? [style.image] : undefined)),
        );
      }
      for (const k of RIG_SOURCES) if (k !== 'idle') delete sources[k];
    }
    const idle = sources.idle;
    const missing = RIG_SOURCES.filter((k) => k !== 'idle' && !sources[k]) as Exclude<RigSource, 'idle'>[];
    if (missing.length) this.logger.log(`Vẽ ${missing.length} dáng cho ${c.id}: ${missing.join(', ')}`);
    await Promise.all(missing.map(async (k) => (sources[k] = await edit(EDITS[k][0], EDITS[k][1], idle))));

    const cutAndCompose = async () => {
      const cut = await cutoutVariants(
        RIG_SOURCES.map((k) => sources[k]!),
        1800,
      );
      const images = Object.fromEntries(RIG_SOURCES.map((k, i) => [k, cut.images[i]]));
      return { cut, rig: await composeRig(images, [...GESTURES]) };
    };
    let { cut, rig } = await cutAndCompose();
    // Lần sửa ảnh không đổi tay (dáng gần như trùng ảnh đứng) thì vẽ lại dáng đó một lần
    const flat = GESTURES.filter((k) => (rig.coverage[k] ?? 0) < 0.006);
    if (flat.length) {
      this.logger.warn(`Dáng ${flat.join(', ')} của ${c.id} gần như không đổi, vẽ lại`);
      await Promise.all(flat.map(async (k) => (sources[k] = await edit(EDITS[k][0], EDITS[k][1], idle))));
      ({ cut, rig } = await cutAndCompose());
    }

    const prefix = `characters/${c.id}/${Date.now()}`;
    const files: Record<string, string> = { source: await this.storage.put(`${prefix}/source.png`, idle) };
    for (const k of RIG_SOURCES) files[`source-${k}`] = await this.storage.put(`${prefix}/source-${k}.png`, sources[k]!);
    for (const [k, b] of Object.entries(rig.poses)) files[k] = await this.storage.put(`${prefix}/${k}.png`, b);
    files.mouth = await this.storage.put(`${prefix}/mouth.png`, rig.mouth);
    files.blink = await this.storage.put(`${prefix}/blink.png`, rig.blink);
    if (existing?.files.original) files.original = existing.files.original;
    return this.repo.upsert({
      kind: 'character',
      key: c.id,
      name: c.name,
      description: c.description,
      files,
      meta: {
        width: cut.width,
        height: cut.height,
        voice: c.voice,
        role: c.role,
        rig: RIG_VERSION,
        headTop: cut.tops[0],
        bodyCx: cut.centersX[0],
        facing: existing?.meta.facing,
        origin: existing?.meta.origin,
        style: existing ? existing.meta.style : style?.tag,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Bối cảnh
  // -------------------------------------------------------------------------
  private async background(
    b: StoryboardBackground,
    base: Asset | null,
    counts: Set<string> | undefined,
    warnings: string[],
    style: StyleRef | null,
  ): Promise<Asset> {
    let asset = await this.repo.get('background', b.key);
    if (asset?.meta.verified === false) {
      this.logger.log(`Bối cảnh ${b.key} trong thư viện chưa đạt kiểm tra, vẽ lại`);
      asset = null;
    }
    // Nền trong thư viện được vẽ độc lập (không phải biến thể của nền gốc này): vẽ lại từ nền gốc
    // để hai cảnh cùng địa điểm thật sự là một căn phòng
    if (asset && base && asset.meta.variantOf !== base.key) {
      this.logger.log(`Bối cảnh ${b.key} chưa phải biến thể của ${base.key}, vẽ lại từ nền gốc`);
      asset = null;
    }
    if (!asset) {
      const { img, problems } = base
        ? await this.drawVerified(b, (prompt) =>
            this.storage
              .read(base.files.image)
              .then((src) => sharp(src).png().toBuffer())
              .then((src) => this.gemini.image(`Vẽ biến thể bối cảnh ${b.key}`, prompt, { aspectRatio: '16:9', images: [src] })),
            backgroundVariantPrompt(b.change || b.description, b.description),
            3,
            2,
          )
        : await this.drawVerified(
            b,
            (prompt) => this.gemini.image(`Vẽ bối cảnh ${b.key}`, prompt, { aspectRatio: '16:9', images: style ? [style.image] : undefined }),
            backgroundPrompt(b.description, b.objects, !!style),
            3,
          );
      if (problems.length) {
        warnings.push(`Bối cảnh "${b.key}" có thể chưa đúng mô tả: ${problems.join('; ')}`);
      }
      this.logger.log(`Đã vẽ bối cảnh ${b.key}${base ? ` (biến thể của ${base.key})` : ''}`);
      const jpg = await sharp(img).jpeg({ quality: 90 }).toBuffer();
      const meta = await sharp(img).metadata();
      const key = await this.storage.put(`backgrounds/${b.key}/${Date.now()}.jpg`, jpg);
      asset = await this.repo.upsert({
        kind: 'background',
        key: b.key,
        name: b.key,
        description: b.description,
        files: { image: key },
        meta: {
          width: meta.width,
          height: meta.height,
          boxes: {},
          instances: {},
          variantOf: base?.key,
          verified: !problems.length,
          style: base ? base.meta.style : style?.tag,
        },
      });
    }

    const boxes = { ...(asset.meta.boxes ?? {}) };
    const instances = { ...(asset.meta.instances ?? {}) };
    const missing = b.objects.filter((o) => !boxes[o]);
    const missingCounts = [...(counts ?? [])].filter((o) => !instances[o]?.length);
    if (missing.length || missingCounts.length) {
      const img = await this.storage.read(asset.files.image);
      if (missing.length) Object.assign(boxes, await this.locate(img, missing));
      for (const o of missingCounts) instances[o] = await this.locateInstances(img, o);
      asset.meta = { ...asset.meta, boxes, instances };
      await this.repo.updateMeta(asset.id, asset.meta);
    }
    return asset;
  }

  /**
   * Model ảnh hay vẽ sai số lượng đồ vật (bài dạy số 3 nhưng đĩa có 5 quả cam; sửa "thêm 1 quả" nhưng chỉ xếp lại 9 quả).
   * Mỗi vòng vẽ song song `width` bản, Gemini (thị giác) đối chiếu với mô tả, lấy bản đạt đầu tiên;
   * không bản nào đạt thì vòng sau vẽ lại kèm lỗi cụ thể.
   */
  private async drawVerified(
    b: StoryboardBackground,
    draw: (prompt: string) => Promise<Buffer>,
    basePrompt: string,
    rounds: number,
    width = 1,
  ): Promise<{ img: Buffer; problems: string[] }> {
    let prompt = basePrompt;
    let last: { img: Buffer; problems: string[] } | null = null;
    for (let round = 1; round <= rounds; round++) {
      const tries = await Promise.all(
        Array.from({ length: width }, async () => {
          const img = await draw(prompt);
          try {
            const check = await this.gemini.json(
              'Kiểm tra bối cảnh',
              VerifySchema,
              [{ inlineData: { mimeType: 'image/jpeg', data: img.toString('base64') } }, { text: verifyBackgroundPrompt(b.description) }],
              { temperature: 0 },
            );
            return { img, problems: check.matches ? [] : check.problems };
          } catch {
            return { img, problems: [] }; // không kiểm tra được thì dùng bản đã vẽ
          }
        }),
      );
      const ok = tries.find((t) => !t.problems.length);
      if (ok) return ok;
      last = tries[0];
      this.logger.warn(`Bối cảnh ${b.key} vòng ${round} chưa đúng: ${tries.map((t) => t.problems.join('; ')).join(' | ')}`);
      prompt = `${basePrompt}\nIMPORTANT — a previous attempt was wrong, fix these problems: ${last.problems.join('; ')}`;
    }
    this.logger.warn(`Bối cảnh ${b.key} vẫn chưa đúng sau ${rounds * width} lần, dùng bản cuối và báo người duyệt`);
    return last!;
  }

  /** Dùng Gemini (thị giác) tìm vị trí vật thể trong ảnh nền để camera và nhãn bám đúng chỗ. */
  private async locate(img: Buffer, objects: string[]): Promise<Record<string, Box>> {
    const result = await this.gemini.json(
      'Định vị vật thể',
      LocateSchema,
      [{ inlineData: { mimeType: 'image/jpeg', data: img.toString('base64') } }, { text: locatePrompt(objects) }],
      { temperature: 0.1 },
    );
    const out: Record<string, Box> = {};
    for (const o of objects) {
      const hit =
        result.objects.find((r) => r.label.toLowerCase() === o.toLowerCase()) ??
        result.objects.find((r) => r.label.toLowerCase().includes(o.toLowerCase()));
      const box = hit ? toBox(hit.box_2d) : null;
      if (box) out[o] = box;
    }
    return out;
  }

  /** Box của từng vật (để đánh số lần lượt khi đếm), theo thứ tự trái → phải */
  private async locateInstances(img: Buffer, object: string): Promise<Box[]> {
    const result = await this.gemini.json(
      'Định vị từng vật để đếm',
      InstancesSchema,
      [{ inlineData: { mimeType: 'image/jpeg', data: img.toString('base64') } }, { text: locateInstancesPrompt(object) }],
      { temperature: 0 },
    );
    return result.items
      .map((i) => toBox(i.box_2d))
      .filter((b): b is Box => !!b)
      .sort((a, b) => (Math.abs(a[0] - b[0]) > 0.08 ? a[0] - b[0] : a[1] - b[1]));
  }
}
