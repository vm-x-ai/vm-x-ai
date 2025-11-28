import { ApiProperty } from '@nestjs/swagger';
import { IsObject, IsNotEmpty } from 'class-validator';
import { SchemaObjectMetadata } from '@nestjs/swagger/dist/interfaces/schema-object-metadata.interface';
import { modules } from '../modules';

export class PermissionsDto {
  @ApiProperty({
    description: 'All available actions for each module',
    type: 'object',
    properties: {
      modules: Object.entries(modules).reduce(
        (acc, [moduleName, { actions }]) => {
          acc[moduleName] = {
            type: 'object',
            properties: {
              actions: {
                type: 'array',
                items: {
                  type: 'string',
                  enum: actions,
                },
              },
              baseResource: {
                type: 'string',
                example: 'workspace:${workspace.name}:environment:${environment.name}:ai-connection',
              },
              itemResource: {
                type: 'string',
                example: 'workspace:${workspace.name}:environment:${environment.name}:ai-connection:${ai-connection.name}',
              },
            },
          } as SchemaObjectMetadata;

          return acc;
        },
        {} as Record<string, SchemaObjectMetadata>
      ),
    },
  })
  @IsObject()
  @IsNotEmpty()
  modules = modules;
}
