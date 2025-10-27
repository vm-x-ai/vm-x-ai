import { Controller, Get } from '@nestjs/common';
import { VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { HealthcheckResponseDto } from './dto/healthcheck.dto';
import { Public } from '../auth/auth.guard';

@Public()
@Controller({ version: VERSION_NEUTRAL })
export class HealthcheckController {
  @Get('healthcheck')
  @ApiOkResponse({
    type: HealthcheckResponseDto,
    description: 'Healthcheck endpoint',
  })
  public healthcheck(): HealthcheckResponseDto {
    return {
      status: 'ok',
    };
  }
}
