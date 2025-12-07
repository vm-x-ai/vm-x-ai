import {
  QueryCommand,
  QueryCommandOutput,
  Row,
  ColumnInfo,
  Datum,
} from '@aws-sdk/client-timestream-query';
import { CompiledQuery, DatabaseConnection, QueryResult } from 'kysely';
import { TimestreamDialectConfig } from './config';

export class AWSTimestreamConnection implements DatabaseConnection {
  constructor(private readonly config: TimestreamDialectConfig) {}

  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    if (compiledQuery.sql.startsWith('INSERT')) {
      // TODO: Implement INSERT support
    }

    const result = await this.config.queryClient.send(
      new QueryCommand({ QueryString: compiledQuery.sql })
    );
    return { rows: this.parseQueryResult<R>(result) };
  }

  streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    // TODO: Implement streamQuery support
    throw new Error(
      'Stream queries are not supported by the AWS Timestream dialect'
    );
  }

  private parseQueryResult<T>(queryResult: QueryCommandOutput): Array<T> {
    const columnInfo = queryResult.ColumnInfo || [];
    const rows = queryResult.Rows || [];

    const data: T[] = [];
    for (const row of rows) {
      data.push(this.parseRow(columnInfo, row) as T);
    }

    return data;
  }

  private parseRow(columnInfo: ColumnInfo[], row: Row) {
    let rowObject = {};
    if (row !== undefined) {
      const data = row.Data || [];
      for (let i = 0; i < data.length; i++) {
        const datum = this.parseDatum(columnInfo[i], data[i]);
        rowObject = { ...rowObject, ...datum };
      }
    }

    return rowObject;
  }

  private parseDatum(info: ColumnInfo, datum: Datum): Record<string, unknown> {
    const columnName = this.parseColumnName(info);

    if ('NullValue' in datum && datum.NullValue === true) {
      return { [columnName]: null };
    }

    const columnType = info.Type;
    if (columnType === undefined) {
      return { [columnName]: null };
    }

    if (columnType.TimeSeriesMeasureValueColumnInfo !== undefined) {
      return this.parseTimeSeries(columnName, datum);
    }
    if (columnType.ArrayColumnInfo !== undefined) {
      const arrayValues = datum.ArrayValue;
      if (info.Type?.ArrayColumnInfo && arrayValues) {
        return {
          [columnName]: this.parseArray(info.Type.ArrayColumnInfo, arrayValues),
        };
      }
    }
    if (columnType.RowColumnInfo !== undefined) {
      const rowColumnInfo = columnType.RowColumnInfo;
      const rowValues = datum.RowValue;
      if (!rowValues) {
        return { [columnName]: null };
      }
      return this.parseRow(rowColumnInfo, rowValues);
    }

    return this.parseScalarType(columnName, info, datum);
  }

  private parseTimeSeries(columnName: string, datum: Datum) {
    const returnVal = {
      [columnName]: '',
    };
    if (datum.TimeSeriesValue) {
      returnVal[columnName] = datum.TimeSeriesValue[0].Value?.ScalarValue ?? '';
    }
    return returnVal;
  }

  private parseScalarType(
    columnName: string,
    columnInfo: ColumnInfo,
    datum: Datum
  ) {
    let value: string | Date | number | undefined = datum.ScalarValue;
    if (value) {
      switch (columnInfo.Type?.ScalarType) {
        case 'TIMESTAMP':
          value = new Date(value);
          break;
        case 'BIGINT':
        case 'DOUBLE':
          value = Number(value);
          break;
        default:
          break;
      }
    }
    return {
      [columnName]: value,
    };
  }

  private parseColumnName(info: ColumnInfo) {
    return info.Name == null ? '' : `${info.Name}`;
  }

  private parseArray(arrayColumnInfo: ColumnInfo, arrayValues: Datum[]) {
    const arrayOutput: Record<string, unknown>[] = [];
    for (const datum of arrayValues) {
      arrayOutput.push(this.parseDatum(arrayColumnInfo, datum));
    }
    return arrayOutput;
  }
}
