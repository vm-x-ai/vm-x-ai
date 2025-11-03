import { HttpStatus, Injectable } from '@nestjs/common';
import { AIConnectionService } from '../ai-connection/ai-connection.service';
import { AIProviderService } from '../ai-provider/ai-provider.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { AIResourceService } from '../ai-resource/ai-resource.service';
import { UserEntity } from '../users/entities/user.entity';
import { throwServiceError } from '../error';
import { ErrorCode } from '../error-code';
import { defer, Observable, Subject } from 'rxjs';
import { ChatCompletionCreateParams } from 'openai/resources/index.js';
import OpenAI from 'openai';

@Injectable()
export class CompletionService {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly aiProviderService: AIProviderService,
    private readonly aiConnectionService: AIConnectionService,
    private readonly aiResourceService: AIResourceService
  ) {}

  public completion(
    workspaceId: string,
    environmentId: string,
    resource: string,
    user: UserEntity,
    request: ChatCompletionCreateParams
  ): Observable<
    | OpenAI.Chat.Completions.ChatCompletion
    | OpenAI.Chat.Completions.ChatCompletionChunk
  > {
    const subject = new Subject<
      | OpenAI.Chat.Completions.ChatCompletion
      | OpenAI.Chat.Completions.ChatCompletionChunk
    >();
    const observable = subject.asObservable();
    defer(async () => {
      await this.workspaceService.throwIfNotWorkspaceMember(
        workspaceId,
        user.id
      );
      const aiResource = await this.aiResourceService.getById(
        workspaceId,
        environmentId,
        resource,
        false,
        true
      );
      const aiConnection = await this.aiConnectionService.getById(
        workspaceId,
        environmentId,
        aiResource.model.connectionId,
        false,
        true,
        true
      );

      const provider = this.aiProviderService.get(aiConnection.provider);
      if (!provider) {
        throwServiceError(
          HttpStatus.BAD_REQUEST,
          ErrorCode.AI_PROVIDER_NOT_FOUND,
          {
            id: aiConnection.provider,
          }
        );
      }

      await provider.completion(
        request,
        aiConnection,
        aiResource.model,
        subject
      );
    }).subscribe({
      complete: () => {
        subject.complete();
      },
      error: (err) => {
        subject.error(err);
      },
    });

    return observable;
  }
}
