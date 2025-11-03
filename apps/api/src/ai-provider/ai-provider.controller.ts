import { Controller, Get } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { AIProviderService } from './ai-provider.service';
import {
  AIProviderConnectionAccordionComponentDto,
  AIProviderConnectionButtonComponentDto,
  AIProviderConnectionEditorComponentDto,
  AIProviderConnectionTypographyComponentDto,
  AIProviderDto,
} from './dto/ai-provider.dto';

@ApiExtraModels(
  AIProviderConnectionAccordionComponentDto,
  AIProviderConnectionButtonComponentDto,
  AIProviderConnectionTypographyComponentDto,
  AIProviderConnectionEditorComponentDto
)
@Controller('ai-providers')
export class AIProviderController {
  constructor(private readonly aiProviderService: AIProviderService) {}

  @Get()
  @ApiOkResponse({
    type: AIProviderDto,
    isArray: true,
    description: 'List all AI providers',
  })
  @ApiOperation({
    summary: 'List all AI providers',
    description: 'Returns a list of all AI providers.',
  })
  public getAll(): AIProviderDto[] {
    return this.aiProviderService.getAll();
  }
}
