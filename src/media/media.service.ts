import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { v2 as cloudinary } from 'cloudinary';
import { PrismaService } from '@/prisma/prisma.service';
import { Prisma } from '@generated/client';

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private readonly MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
  private readonly ALLOWED_MIME_TYPES = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'video/mp4',
    'video/quicktime',
    'video/x-msvideo',
  ];

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get media file by ID (optionally scoped by organization)
   */
  async getFileById(fileId: string, organizationId?: string) {
    const where: Prisma.MediaFileWhereInput = { id: fileId };

    if (organizationId) {
      where.organizationId = organizationId;
    }

    const file = await this.prisma.mediaFile.findFirst({ where });
    if (!file) throw new NotFoundException('Media file not found');

    return file;
  }

  /**
   * Upload single file to Cloudinary + DB
   */
  async uploadFile(
    userId: string,
    organizationId: string,
    file: Express.Multer.File,
  ) {
    this.validateFile(file);

    const uploaded = await cloudinary.uploader.upload(
      `data:${file.mimetype};base64,${file.buffer.toString('base64')}`,
      {
        resource_type: file.mimetype.startsWith('video/') ? 'video' : 'image',
        folder: `org_${organizationId}`,
      },
    );

    return this.prisma.mediaFile.create({
      data: {
        userId,
        organizationId,
        filename: this.generateFilename(file.originalname),
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        url: uploaded.secure_url,
        publicId: uploaded.public_id,
        thumbnailUrl: uploaded.thumbnail_url,
        duration: uploaded.duration,
        metadata: {
          width: uploaded.width,
          height: uploaded.height,
          format: uploaded.format,
        },
      },
    });
  }

  /**
   * Upload multiple files efficiently
   */
  async uploadMultipleFiles(
    files: Express.Multer.File[],
    userId: string,
    organizationId: string,
  ) {
    // 1. Validate files first
    files.forEach((f) => this.validateFile(f));

    // 2. Upload all files concurrently to Cloudinary
    const uploads = await Promise.all(
      files.map((file) =>
        cloudinary.uploader.upload(
          `data:${file.mimetype};base64,${file.buffer.toString('base64')}`,
          {
            resource_type: file.mimetype.startsWith('video/')
              ? 'video'
              : 'image',
            folder: `org_${organizationId}`,
          },
        ),
      ),
    );

    // 3. Store metadata in DB (bulk insert)
    await this.prisma.mediaFile.createMany({
      data: uploads.map((uploaded, idx) => ({
        userId,
        organizationId,
        filename: this.generateFilename(files[idx].originalname),
        originalName: files[idx].originalname,
        mimeType: files[idx].mimetype,
        size: files[idx].size,
        url: uploaded.secure_url,
        publicId: uploaded.public_id,
        thumbnailUrl: uploaded.thumbnail_url,
        duration: uploaded.duration,
        metadata: {
          width: uploaded.width,
          height: uploaded.height,
          format: uploaded.format,
        },
      })),
    });

    // 4. Return the uploaded URLs
    return uploads.map((u) => ({
      fileId: u.id,
      url: u.secure_url,
      publicId: u.public_id,
    }));
  }

  /**
   * Delete file from Cloudinary + DB
   */
  async deleteFile(fileId: string, organizationId: string) {
    const file = await this.prisma.mediaFile.findUnique({
      where: { id: fileId, organizationId },
    });
    if (!file) throw new NotFoundException('File not found');

    // Delete from Cloudinary
    if (file.publicId) {
      const resourceType: 'image' | 'video' = file.mimeType.startsWith('video/')
        ? 'video'
        : 'image';

      try {
        await cloudinary.uploader.destroy(file.publicId, {
          resource_type: resourceType,
        });
      } catch (err) {
        this.logger.error(
          `Failed to delete Cloudinary resource: ${file.publicId}`,
          err.stack,
        );
      }
    }

    // Delete from DB
    await this.prisma.mediaFile.delete({ where: { id: fileId } });
    return { message: 'File deleted successfully' };
  }

  async deleteMultipleFiles(fileIds: string[], organizationId: string) {
  if (!fileIds.length) throw new BadRequestException('No file IDs provided');

  const files = await this.prisma.mediaFile.findMany({
    where: { id: { in: fileIds }, organizationId },
  });

  if (!files.length) throw new NotFoundException('No matching files found');

  // Delete from Cloudinary in parallel
  await Promise.all(
    files.map(async (file) => {
      if (file.publicId) {
        const resourceType: 'image' | 'video' = file.mimeType.startsWith('video/')
          ? 'video'
          : 'image';

        try {
          await cloudinary.uploader.destroy(file.publicId, {
            resource_type: resourceType,
          });
        } catch (err) {
          this.logger.error(
            `Failed to delete Cloudinary resource: ${file.publicId}`,
            err.stack,
          );
        }
      }
    }),
  );

  // Delete all from DB in one go
  await this.prisma.mediaFile.deleteMany({
    where: { id: { in: fileIds } },
  });

  return { message: 'Files deleted successfully' };
}




  /**
   * Cron job: cleanup expired files
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanupExpiredFiles() {
    const now = new Date();
    const expiredFiles = await this.prisma.mediaFile.findMany({
      where: { expiresAt: { lte: now } },
    });

    this.logger.log(`Found ${expiredFiles.length} expired files`);

    for (const file of expiredFiles) {
      try {
        await this.deleteFile(file.id, file.organizationId);
        this.logger.log(`Deleted expired file: ${file.id}`);
      } catch (err) {
        this.logger.error(`Failed to delete file ${file.id}`, err.stack);
      }
    }
  }

  // ------------------------
  // Helpers
  // ------------------------

  private generateFilename(originalName: string): string {
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 8);
    const extension = originalName.split('.').pop();
    return `file_${timestamp}_${randomString}.${extension}`;
  }

  private validateFile(file: Express.Multer.File) {
    if (!this.ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        `File type ${file.mimetype} is not allowed`,
      );
    }

    if (file.size > this.MAX_FILE_SIZE) {
      throw new BadRequestException(
        `File too large. Max size is ${this.MAX_FILE_SIZE / 1024 / 1024}MB`,
      );
    }
  }
}
