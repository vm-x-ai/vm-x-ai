import { Controller, Get } from '@nestjs/common';
import { ApiExtraModels, ApiInternalServerErrorResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AIProviderService } from './ai-provider.service';
import {
  AIProviderConnectionAccordionComponentDto,
  AIProviderConnectionButtonComponentDto,
  AIProviderConnectionEditorComponentDto,
  AIProviderConnectionTypographyComponentDto,
  AIProviderDto,
} from './dto/ai-provider.dto';
import { ServiceError } from '../types';

@ApiExtraModels(
  AIProviderConnectionAccordionComponentDto,
  AIProviderConnectionButtonComponentDto,
  AIProviderConnectionTypographyComponentDto,
  AIProviderConnectionEditorComponentDto
)
@Controller('ai-provider')
@ApiTags('AI Provider')
@ApiInternalServerErrorResponse({
  type: ServiceError,
  description: 'Server Error',
})
export class AIProviderController {
  constructor(private readonly aiProviderService: AIProviderService) {}

  @Get()
  @ApiOkResponse({
    type: AIProviderDto,
    isArray: true,
    description: 'List all AI providers',
  })
  @ApiOperation({
    operationId: 'getAIProviders',
    summary: 'List all AI providers',
    description: 'Returns a list of all AI providers.',
  })
  public getAll(): AIProviderDto[] {
    return this.aiProviderService.getAll();
  }
}
