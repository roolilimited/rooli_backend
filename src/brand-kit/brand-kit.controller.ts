import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { BrandKitService } from './brand-kit.service';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { CreateBrandKitDto } from './dtos/create-brand-kit.dto';
import { UpdateBrandKitDto } from './dtos/update-brand-kit.dto';
import { BrandKit } from '@generated/client';

@ApiTags('Brand Kit')
@ApiBearerAuth()
@Controller('brand-kit/:organizationId')
export class BrandKitController {
  constructor(private readonly brandKitService: BrandKitService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new brand kit' })
  async create(
    @Param('organizationId') organizationId: string,
    @Body() dto: CreateBrandKitDto,
  ) {
    return this.brandKitService.create(organizationId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all brand kits for an organization' })
  async findByOrganization(
    @Param('organizationId') organizationId: string,
    @Query('includeInactive') includeInactive?: boolean,
  ) {
    return this.brandKitService.findByOrganization(
      organizationId,
      includeInactive,
    );
  }

  @Get('active')
  @ApiOperation({ summary: 'Get the active brand kit for an organization' })
  async getActive(@Param('organizationId') organizationId: string) {
    return this.brandKitService.getActiveBrandKit(organizationId);
  }

  @Patch(':id/deactivate')
  @ApiOperation({ summary: 'Deactivate a brand kit' })
  async deactivate(
    @Param('id') id: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.brandKitService.deactivate(id, organizationId);
  }

  @Patch(':id/activate')
  @ApiOperation({ summary: 'Activate a brand kit' })
  async activate(
    @Param('id') id: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.brandKitService.activate(id, organizationId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a brand kit' })
  async update(
    @Param('id') id: string,
    @Param('organizationId') organizationId: string,
    @Body() dto: UpdateBrandKitDto,
  ) {
    return this.brandKitService.update(id, organizationId, dto);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get brand kit by ID',
    description:
      'Retrieve a specific brand kit by its unique ID. Returns 404 if not found.',
  })
  @ApiResponse({
    status: 200,
    description: 'Brand kit retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'Brand kit not found' })
  async getBrandKitById(@Param('id') id: string): Promise<BrandKit> {
    return this.brandKitService.getById(id);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete brand kit by ID',
    description: 'Deletes a specific brand kit by its unique ID.',
  })
  
  @ApiResponse({
    status: 200,
    description: 'Brand kit deleted successfully',
    schema: {
      example: { message: 'Brand kit deleted successfully' },
    },
  })
  @ApiResponse({ status: 404, description: 'Brand kit not found' })
  async deleteBrandKit(@Param('id') id: string,  @Param('organizationId') organizationId: string,): Promise<{ message: string }> {
    return this.brandKitService.delete(id, organizationId);
  }
}
