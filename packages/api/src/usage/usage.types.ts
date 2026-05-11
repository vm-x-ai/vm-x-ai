import { RequestUsageQueryRawResultDto } from './dto/request-query-result.dto';
import { RequestUsageQueryDto } from './dto/request-query.dto';
import { RequestUsageDto } from './dto/request-usage.dto';

export const REQUEST_USAGE_PROVIDER = 'REQUEST_USAGE_PROVIDER';

export interface RequestUsageProvider {
  push(...usage: RequestUsageDto[]): Promise<void>;
  query(query: RequestUsageQueryDto): Promise<RequestUsageQueryRawResultDto[]>;
}
