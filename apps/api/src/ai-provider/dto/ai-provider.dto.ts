import { ApiProperty, getSchemaPath } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsObject,
  IsArray,
  IsNumber,
  ValidateNested,
  IsIn,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { $enum } from 'ts-enum-util';

export class AIProviderLogoDto {
  @ApiProperty({
    description: 'The URL of the AI provider logo',
    example: 'https://example.com/logo.png',
  })
  @IsString()
  @IsNotEmpty()
  url: string;
}

export enum AIProviderComponentType {
  LINK_BUTTON = 'link-button',
  ACCORDION = 'accordion',
  EDITOR = 'editor',
  TYPORAPHY = 'typography',
}

export const AIProviderComponentTypeEnum = $enum(
  AIProviderComponentType
).getValues();

export class AIProviderConnectionButtonComponentDto {
  @ApiProperty({
    description: "The component type (should be 'link-button')",
    enum: [AIProviderComponentType.LINK_BUTTON],
    example: AIProviderComponentType.LINK_BUTTON,
  })
  @IsString()
  @IsIn([AIProviderComponentType.LINK_BUTTON])
  type: AIProviderComponentType.LINK_BUTTON;

  @ApiProperty({
    description: 'Text content of the button',
    example: 'Connect your account',
  })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiProperty({
    description: 'Style overrides for the button component',
    required: false,
    type: Object,
    additionalProperties: true,
    nullable: true,
    example: { margin: '10px' },
  })
  @IsOptional()
  @IsObject()
  sx?: Record<string, unknown> | null;

  @ApiProperty({
    description: 'URL to which the button navigates',
    example: 'https://provider.com/auth',
  })
  @IsString()
  @IsNotEmpty()
  url: string;

  @ApiProperty({
    description: 'Target attribute for the link, e.g., _blank',
    required: false,
    nullable: true,
    type: 'string',
    example: '_blank',
  })
  @IsOptional()
  @IsString()
  target?: string | null;

  @ApiProperty({
    type: 'string',
    nullable: true,
    description: 'Helper text to be displayed near the button',
    required: false,
    example: 'Sign in securely with your OpenAI account.',
  })
  @IsOptional()
  @IsString()
  helperText?: string | null;
}

export enum AIProviderConnectionTypographyVariant {
  BODY1 = 'body1',
  BODY2 = 'body2',
  CAPTION = 'caption',
  H1 = 'h1',
  H2 = 'h2',
  H3 = 'h3',
  H4 = 'h4',
  H5 = 'h5',
  H6 = 'h6',
  SUBTITLE1 = 'subtitle1',
  SUBTITLE2 = 'subtitle2',
}

export class AIProviderConnectionTypographyComponentDto {
  @ApiProperty({
    description: "The component type (should be 'typography')",
    enum: [AIProviderComponentType.TYPORAPHY],
    example: AIProviderComponentType.TYPORAPHY,
  })
  @IsString()
  @IsIn([AIProviderComponentType.TYPORAPHY])
  type: AIProviderComponentType.TYPORAPHY;

  @ApiProperty({
    description: 'The text content to display',
    example: 'To continue, connect your OpenAI account.',
  })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiProperty({
    description: 'Typography style variant',
    enum: AIProviderConnectionTypographyVariant,
    example: AIProviderConnectionTypographyVariant.BODY1,
  })
  @IsString()
  @IsEnum(AIProviderConnectionTypographyVariant)
  variant: AIProviderConnectionTypographyVariant;

  @ApiProperty({
    description: 'Style overrides for the typography component',
    type: Object,
    additionalProperties: true,
    nullable: true,
    required: false,
    example: { fontWeight: 'bold' },
  })
  @IsOptional()
  @IsObject()
  sx?: Record<string, unknown> | null;
}

export class AIProviderConnectionEditorComponentDto {
  @ApiProperty({
    description: "The component type (should be 'editor')",
    enum: [AIProviderComponentType.EDITOR],
    example: AIProviderComponentType.EDITOR,
  })
  @IsString()
  @IsIn([AIProviderComponentType.EDITOR])
  type: AIProviderComponentType.EDITOR;

  @ApiProperty({
    description: 'Content/code to display in the editor',
    example: 'const apiKey = "..."',
  })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiProperty({
    description: 'Programming language for syntax highlighting',
    example: 'json',
  })
  @IsString()
  @IsNotEmpty()
  language: string;

  @ApiProperty({
    description: 'Height of the editor, e.g., 200px',
    example: '200px',
  })
  @IsString()
  @IsNotEmpty()
  height: string;

  @ApiProperty({
    description: 'Whether the editor is read-only',
    required: false,
    example: true,
    nullable: true,
    type: 'boolean',
  })
  @IsOptional()
  readOnly?: boolean | null;

  @ApiProperty({
    description: 'Message to display if the editor is read-only',
    required: false,
    example: 'You cannot edit the API key directly.',
    nullable: true,
    type: 'string',
  })
  @IsOptional()
  @IsString()
  readOnlyMessage?: string | null;
}

export class AIProviderConnectionAccordionComponentDto {
  @ApiProperty({
    description: "The component type (should be 'accordion')",
    enum: [AIProviderComponentType.ACCORDION],
    example: AIProviderComponentType.ACCORDION,
  })
  @IsString()
  @IsIn([AIProviderComponentType.ACCORDION])
  type: AIProviderComponentType.ACCORDION;

  @ApiProperty({
    description: 'Accordion title',
    example: 'Advanced Settings',
  })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({
    description:
      'Accordion content elements, may include typography or editor components',
    type: 'array',
    items: {
      oneOf: [
        { $ref: getSchemaPath(AIProviderConnectionTypographyComponentDto) },
        { $ref: getSchemaPath(AIProviderConnectionEditorComponentDto) },
      ],
    },
    example: [{ type: 'typography', content: 'Details...', variant: 'body1' }],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => Object, {
    discriminator: {
      property: 'type',
      subTypes: [
        {
          value: AIProviderConnectionTypographyComponentDto,
          name: 'typography',
        },
        { value: AIProviderConnectionEditorComponentDto, name: 'editor' },
      ],
    },
  })
  elements: (
    | AIProviderConnectionTypographyComponentDto
    | AIProviderConnectionEditorComponentDto
  )[];
}

export class AIProviderConnectionDto {
  @ApiProperty({
    description: 'JSONSchema definition or data required for connection',
    type: Object,
    additionalProperties: true,
    example: {
      type: 'object',
      properties: {
        apiKey: { type: 'string' },
      },
      required: ['apiKey'],
    },
  })
  @IsObject()
  @IsNotEmpty()
  form: Record<string, unknown>;

  @ApiProperty({
    description: 'UI components to customize the connection experience',
    required: false,
    type: 'array',
    nullable: true,
    items: {
      oneOf: [
        { $ref: getSchemaPath(AIProviderConnectionAccordionComponentDto) },
        { $ref: getSchemaPath(AIProviderConnectionButtonComponentDto) },
      ],
    },
    example: [{ type: 'link-button', content: 'Connect', url: 'https://...' }],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => Object)
  uiComponents?: Array<
    | AIProviderConnectionAccordionComponentDto
    | AIProviderConnectionButtonComponentDto
  > | null;
}

export class AIProviderModelOptionsDto {
  @ApiProperty({
    description: 'Maximum number of tokens for this model',
    required: false,
    example: 128,
    nullable: true,
    type: 'number',
  })
  @IsOptional()
  @IsNumber()
  maxTokens?: number | null;
}

export class AIProviderConfigDto {
  @ApiProperty({
    description: 'Logo for the AI provider',
    type: () => AIProviderLogoDto,
  })
  @ValidateNested()
  @Type(() => AIProviderLogoDto)
  logo: AIProviderLogoDto;

  @ApiProperty({
    description: 'Connection form and UI information',
    type: () => AIProviderConnectionDto,
  })
  @ValidateNested()
  @Type(() => AIProviderConnectionDto)
  connection: AIProviderConnectionDto;
}

export class AIProviderDto {
  @ApiProperty({
    description: 'The unique provider identifier',
    example: 'openai',
  })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiProperty({
    description: 'Display name of the provider',
    example: 'OpenAI',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'Description of the AI provider',
    required: false,
    nullable: true,
    type: 'string',
    example: 'The official OpenAI interface.',
  })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiProperty({
    description: 'Configuration details for the provider',
    type: () => AIProviderConfigDto,
  })
  @ValidateNested()
  @Type(() => AIProviderConfigDto)
  config: AIProviderConfigDto;

  @ApiProperty({
    description: 'Default model for the provider',
    example: 'gpt-4.1',
  })
  @IsString()
  @IsNotEmpty()
  defaultModel: string;
}
